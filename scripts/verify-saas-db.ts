/**
 * The SaaS layer against a real database: agency provisioning, password
 * sign-in and lockout, user management rules, encrypted credentials, and — the
 * one that matters most — that the DATABASE refuses cross-agency reads.
 *
 * Creates two throwaway agencies and deletes them at the end. Sends no mail and
 * calls no external API. Run against a disposable database:
 *
 *   DB_ENFORCE_RLS=1 npm run verify:saas:db
 */

import "@/lib/env";
import { eq, inArray, sql } from "drizzle-orm";
import { db, withTenant } from "@/lib/db/client";
import { clients, tenantMailSettings, tenants, users } from "@/db/schema";
import { createAgency, createUser, resetPassword, updateUser, type Actor } from "@/lib/admin/accounts";
import { sealSecret, openSecret } from "@/lib/crypto/tenantSecrets";
import { tryMailConfigFor, listWatchedMailboxes, legacyMailSlug } from "@/lib/mail/settings";
import { maybeAutoSend } from "@/lib/certificate/autoSend";
import { POST as login } from "@/app/api/auth/login/route";
import { writeAll } from "@/lib/nowcerts/sync";
import { mapCoverages, mapInsured, mapPolicyHeader, mapVehicle } from "@/lib/nowcerts/map";
import { loadCertificate } from "@/lib/certificate/load";
import { certificateHolders, policies, producers, vehicles } from "@/db/schema";
import { saveOAuthConnection, disconnectMail } from "@/lib/mail/settings";
import { accessTokenFor, forgetAccessToken, setHttpForTests } from "@/lib/mail/oauth";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}
async function throws(label: string, fn: () => Promise<unknown>, match?: RegExp) {
  try {
    await fn();
    check(label, false, "did not throw");
  } catch (err) {
    const msg = (err as Error).message;
    check(label, !match || match.test(msg), msg);
  }
}

const NESTNIC: Actor = { kind: "platform", id: "00000000-0000-0000-0000-00000000abcd", email: "ops@nestnic.test" };
const stamp = Date.now().toString(36);

async function signIn(email: string, password: string) {
  const res = await login(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
  );
  return { status: res.status, body: await res.json(), cookie: res.headers.get("set-cookie") ?? "" };
}

async function main() {
  if (process.env.DB_ENFORCE_RLS !== "1") {
    console.log("NOTE  DB_ENFORCE_RLS is not 1 — the isolation checks below prove only the app layer.\n");
  }

  // ---------------------------------------------------------------- provisioning
  const a = await createAgency(NESTNIC, {
    name: `Verify Alpha ${stamp}`,
    admin: { name: "Alice Admin", email: `alice-${stamp}@alpha.test` },
  });
  const b = await createAgency(NESTNIC, {
    name: `Verify Beta ${stamp}`,
    allowUserManagement: true,
    admin: { name: "Bob Admin", email: `bob-${stamp}@beta.test` },
  });
  check("agency created with a temporary password", a.tempPassword.length >= 14);

  const [aRow] = await db.select().from(tenants).where(eq(tenants.id, a.tenantId));
  check("new agency defaults: users by Nestnic, auto-send OFF, CertFlow data", !aRow.allowUserManagement && !aRow.autoSend && aRow.dataSource === "certflow");

  const [alice] = await db.select().from(users).where(eq(users.email, `alice-${stamp}@alpha.test`));
  check("first admin must change password", alice.mustChangePassword && alice.role === "admin");
  check("password stored as scrypt hash, not plaintext", alice.passwordHash!.startsWith("scrypt$") && !alice.passwordHash!.includes(a.tempPassword));

  await throws("same email cannot join a second agency", () =>
    createUser(NESTNIC, b.tenantId, { name: "Dup", email: `alice-${stamp}@alpha.test`, role: "reviewer" }), /already has/);
  await throws("same agency short name refused", () =>
    createAgency(NESTNIC, { name: `Verify Alpha ${stamp}`, admin: { name: "X", email: `x-${stamp}@x.test` } }), /already exists/);

  // ---------------------------------------------------------------- sign-in
  const wrong = await signIn(`alice-${stamp}@alpha.test`, "not-the-password-1");
  const unknown = await signIn(`nobody-${stamp}@alpha.test`, "whatever-123");
  check("wrong password → 401", wrong.status === 401);
  check("unknown email → identical 401 message", unknown.status === 401 && unknown.body.error === wrong.body.error);
  const ok = await signIn(`alice-${stamp}@alpha.test`, a.tempPassword);
  check("temporary password signs in", ok.status === 200 && ok.body.mustChangePassword === true);
  check("session cookie is HttpOnly + SameSite=Strict", /HttpOnly/i.test(ok.cookie) && /SameSite=Strict/i.test(ok.cookie));

  for (let i = 0; i < 5; i++) await signIn(`bob-${stamp}@beta.test`, "wrong-password-9");
  const locked = await signIn(`bob-${stamp}@beta.test`, b.tempPassword);
  check("5 failures lock the account, even for the right password", locked.status === 429);
  const { tempPassword: bobReset } = await resetPassword(NESTNIC, b.tenantId, b.adminId);
  check("a reset clears the lock", (await signIn(`bob-${stamp}@beta.test`, bobReset)).status === 200);

  await updateUser(NESTNIC, a.tenantId, a.adminId, { status: "disabled" }).catch(() => {});
  const [aliceAfter] = await db.select().from(users).where(eq(users.id, a.adminId));
  check("cannot disable an agency's last active admin", aliceAfter.status === "active");

  const carol = await createUser({ kind: "agency", id: b.adminId, email: `bob-${stamp}@beta.test` }, b.tenantId, {
    name: "Carol Reviewer",
    email: `carol-${stamp}@beta.test`,
    role: "reviewer",
  });
  await updateUser({ kind: "agency", id: b.adminId, email: "" }, b.tenantId, carol.id, { status: "disabled" });
  check("disabled user cannot sign in", (await signIn(`carol-${stamp}@beta.test`, carol.tempPassword)).status === 403);
  await throws(
    "admin cannot demote themselves",
    () => updateUser({ kind: "agency", id: b.adminId, email: "" }, b.tenantId, b.adminId, { role: "reviewer" }),
    /own admin/
  );

  await db.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, b.tenantId));
  check("suspended agency cannot sign in", (await signIn(`bob-${stamp}@beta.test`, bobReset)).status === 403);
  await db.update(tenants).set({ status: "active" }).where(eq(tenants.id, b.tenantId));

  // ---------------------------------------------------------------- secrets
  await withTenant(a.tenantId, async (tx) => {
    await tx.insert(tenantMailSettings).values({
      tenantId: a.tenantId,
      emailAddress: `coi-${stamp}@alpha.test`,
      username: `coi-${stamp}@alpha.test`,
      passwordEnc: await sealSecret(tx, a.tenantId, "alpha-app-password"),
      imapHost: "imap.gmail.com",
      smtpHost: "smtp.gmail.com",
    });
  });
  const [stored] = await db.select().from(tenantMailSettings).where(eq(tenantMailSettings.tenantId, a.tenantId));
  check("mail password stored encrypted", !stored.passwordEnc!.includes("alpha-app-password") && stored.passwordEnc!.startsWith("v1."));
  const cfg = await tryMailConfigFor(a.tenantId);
  check("agency A decrypts its own mailbox", cfg?.appPassword === "alpha-app-password" && cfg.host === "imap.gmail.com");
  await throws("agency B's key cannot open agency A's secret", () =>
    withTenant(b.tenantId, (tx) => openSecret(tx, b.tenantId, stored.passwordEnc!)));
  check("agency with no mailbox gets none (never the .env mailbox)", (await tryMailConfigFor(b.tenantId)) === null);
  const watched = await listWatchedMailboxes();
  check("watcher picks up A's mailbox", watched.some((w) => w.tenantId === a.tenantId));
  check("watcher ignores B (no mailbox)", !watched.some((w) => w.tenantId === b.tenantId));
  check(`only "${legacyMailSlug()}" may use the .env mailbox`, watched.every((w) => w.version !== "env" || w.tenantId !== a.tenantId));

  // ---------------------------------------------------------------- isolation
  await withTenant(b.tenantId, (tx) =>
    tx.insert(clients).values({ tenantId: b.tenantId, legalName: `Beta Trucking ${stamp}`, addressLines: "1 Road" })
  );
  const seenByA = await withTenant(a.tenantId, (tx) => tx.select().from(clients).where(sql`${clients.legalName} like ${"Beta Trucking " + stamp}`));
  check("agency A cannot read agency B's clients", seenByA.length === 0);
  const unfiltered = await withTenant(a.tenantId, (tx) => tx.select({ id: users.id, tenantId: users.tenantId }).from(users));
  check(
    "an UNFILTERED users query in A's transaction returns only A's users",
    unfiltered.length > 0 && unfiltered.every((u) => u.tenantId === a.tenantId),
    `${unfiltered.length} row(s)`
  );
  const mailSeenByB = await withTenant(b.tenantId, (tx) => tx.select().from(tenantMailSettings));
  check("agency B cannot read agency A's mail settings", mailSeenByB.length === 0);
  if (process.env.DB_ENFORCE_RLS === "1") {
    await throws("inserting a row for ANOTHER agency is refused by the database", () =>
      withTenant(a.tenantId, (tx) => tx.insert(clients).values({ tenantId: b.tenantId, legalName: "Smuggled", addressLines: "x" })));
    const role = await withTenant(a.tenantId, (tx) => tx.execute(sql`select current_user as u`));
    const who = ((role as unknown as { rows?: { u: string }[] }).rows ?? (role as unknown as { u: string }[]))[0]?.u;
    check("tenant transactions run as certflow_app", who === "certflow_app", who);
  }

  // ---------------------------------------------------------------- NowCerts write path
  const row = (id: string, policyNo: string, insuredId: string, name: string, exp = "2099-01-01") => ({
    DatabaseId: id, Number: policyNo, EffectiveDate: "2026-01-01T00:00:00", ExpirationDate: exp + "T00:00:00",
    Active: true, Status: "Active", InsuredDatabaseId: insuredId, InsuredCommercialName: name,
    InsuredAddressLine1: "9 Depot Rd", InsuredCity: "Dallas", InsuredState: "TX", InsuredZipCode: "75201",
    InsuredDOT_Number: "7654321", CarrierName: `Verify Carrier ${stamp}`, CarrierNAIC: `9${stamp.slice(-4)}`,
  });
  const fixture = (rows: Record<string, unknown>[], covs: unknown, vehs: Record<string, unknown>[]) => ({
    headers: rows.map((r) => mapPolicyHeader(r)!),
    insureds: new Map(rows.map((r) => [mapInsured(r)!.externalId, mapInsured(r)!])),
    coverages: mapCoverages(covs),
    vehicles: vehs.map((x) => mapVehicle(x, "")!),
    policiesRead: rows.length,
  });
  // A hand-entered client must survive every sync untouched.
  await withTenant(a.tenantId, (tx) => tx.insert(clients).values({ tenantId: a.tenantId, legalName: `Manual Client ${stamp}`, addressLines: "x" }));
  const first = await writeAll(a.tenantId, fixture(
    [row("nc-p1", "CA-100", "nc-i1", `Lone Star Haulers ${stamp}`)],
    {
      automobileLiabilitiesCoverages: [{ policyId: "nc-p1", scheduledAutos: true, limitCombinedSingle: "1000000" }],
      cargoLiabilitiesCoverages: [{ policyId: "nc-p1", limit: "100000", deductible: "1000" }],
    },
    [{ databaseId: "nc-v1", vin: "1XKYDP9X4NJ441201", year: 2022, make: "KENWORTH", model: "T680", policyDatabaseId: "nc-p1" }]
  ));
  check("sync created client, 2 coverage rows, 1 vehicle", first.clients === 1 && first.coverageRows === 2 && first.vehicles === 1, JSON.stringify(first));
  const again = await writeAll(a.tenantId, fixture(
    [row("nc-p1", "CA-100", "nc-i1", `Lone Star Haulers ${stamp}`)],
    { automobileLiabilitiesCoverages: [{ policyId: "nc-p1", scheduledAutos: true, limitCombinedSingle: "1000000" }], cargoLiabilitiesCoverages: [{ policyId: "nc-p1", limit: "100000", deductible: "1000" }] },
    [{ databaseId: "nc-v1", vin: "1XKYDP9X4NJ441201", year: 2022, make: "KENWORTH", model: "T680", policyDatabaseId: "nc-p1" }]
  ));
  const counts = await withTenant(a.tenantId, async (tx) => ({
    clients: (await tx.select().from(clients)).length,
    policies: (await tx.select().from(policies)).length,
    vehicles: (await tx.select().from(vehicles)).length,
  }));
  check("re-running the sync is idempotent (no duplicates)", again.clients === 1 && counts.clients === 2 && counts.policies === 2 && counts.vehicles === 1, JSON.stringify(counts));

  const [synced] = await withTenant(a.tenantId, (tx) => tx.select().from(clients).where(eq(clients.source, "nowcerts")));
  check("synced client carries DOT for exact matching", synced.dotNumber === "7654321" && synced.status === "active");
  const holderId = await withTenant(a.tenantId, async (tx) => {
    await tx.update(producers).set({ addressLines: "1 Main St\nDallas, TX 75201" }).where(eq(producers.tenantId, a.tenantId));
    const [h] = await tx.insert(certificateHolders).values({ tenantId: a.tenantId, name: "Broker LLC", addressLines: "5 Elm St" }).returning();
    return h.id;
  });
  const cert = await loadCertificate({
    tenantId: a.tenantId, clientId: synced.id, holderId, certificateNumber: "COI-VERIFY-1",
    issueDate: "09/21/2026", authorizedRep: "Verify", acordEdition: "2016/03",
  });
  check("certificate assembles from synced NowCerts data", cert.coverages.auto.limits.combinedSingle === "1,000,000" && cert.coverages.other[0]?.label === "Motor Truck Cargo");
  check("synced insurer + NAIC printed", cert.insurers[0]?.name === `Verify Carrier ${stamp}` && Boolean(cert.insurers[0]?.naic));

  // Policy lapses in NowCerts -> retired here, client stops matching; manual client untouched.
  const lapsed = await writeAll(a.tenantId, fixture([], {}, []));
  const after = await withTenant(a.tenantId, async (tx) => ({
    policies: await tx.select({ status: policies.status }).from(policies),
    clients: await tx.select({ name: clients.legalName, status: clients.status, source: clients.source }).from(clients),
    vehicles: (await tx.select().from(vehicles)).length,
  }));
  check("vanished policies retired, not deleted", lapsed.retiredPolicies === 2 && after.policies.every((p) => p.status === "inactive"));
  check("vanished NowCerts client set inactive", after.clients.find((c) => c.source === "nowcerts")?.status === "inactive");
  check("hand-entered client never touched by sync", after.clients.find((c) => c.source === "certflow")?.status === "active");
  check("vehicles that left the schedule removed", after.vehicles === 0);

  // ---------------------------------------------------------------- OAuth inbox
  process.env.MICROSOFT_OAUTH_CLIENT_ID ||= "ms-client";
  process.env.MICROSOFT_OAUTH_CLIENT_SECRET ||= "ms-secret";
  const tokenCalls: { url: string; body: string }[] = [];
  setHttpForTests((async (input: RequestInfo | URL, init?: RequestInit) => {
    tokenCalls.push({ url: String(input), body: String(init?.body ?? "") });
    if (String(input).includes("/revoke")) return new Response("", { status: 200 });
    return new Response(JSON.stringify({ access_token: "at-1", refresh_token: "rt-rotated", expires_in: 3600 }), { status: 200 });
  }) as typeof fetch);

  await saveOAuthConnection({ tenantId: b.tenantId, userId: b.adminId }, "microsoft", {
    account: `coi-${stamp}@beta.test`,
    refreshToken: "rt-original",
    scopes: "Mail.Read Mail.Send",
  });
  const [oauthRow] = await db.select().from(tenantMailSettings).where(eq(tenantMailSettings.tenantId, b.tenantId));
  check("OAuth inbox saved: provider + account, no password", oauthRow.provider === "microsoft" && oauthRow.passwordEnc === null && oauthRow.emailAddress === `coi-${stamp}@beta.test`);
  check("refresh token stored encrypted", Boolean(oauthRow.oauthRefreshTokenEnc) && !oauthRow.oauthRefreshTokenEnc!.includes("rt-original"));
  const oauthCfg = await tryMailConfigFor(b.tenantId);
  check("mail config says: Microsoft API, no password", oauthCfg?.oauth?.provider === "microsoft" && oauthCfg.appPassword === "");
  check("watcher now watches B too", (await listWatchedMailboxes()).some((w) => w.tenantId === b.tenantId));

  forgetAccessToken(b.tenantId);
  const at = await accessTokenFor(b.tenantId, "microsoft");
  check("access token obtained by refresh", at === "at-1" && tokenCalls.some((c) => c.body.includes("refresh_token=rt-original")));
  const rotated = await withTenant(b.tenantId, async (tx) => {
    const [r] = await tx.select().from(tenantMailSettings);
    return openSecret(tx, b.tenantId, r.oauthRefreshTokenEnc!);
  });
  check("Microsoft's rotated refresh token is saved (encrypted)", rotated === "rt-rotated");
  check("agency A cannot see B's inbox connection", (await withTenant(a.tenantId, (tx) => tx.select().from(tenantMailSettings).where(eq(tenantMailSettings.tenantId, b.tenantId)))).length === 0);
  await throws("agency A cannot use B's inbox token", () => accessTokenFor(a.tenantId, "microsoft"));

  // Switch B to Google, then disconnect: the Google grant must be revoked at Google.
  await saveOAuthConnection({ tenantId: b.tenantId, userId: b.adminId }, "google", {
    account: `coi-${stamp}@beta.test`,
    refreshToken: "rt-google-1",
    scopes: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
  });
  tokenCalls.length = 0;
  await disconnectMail({ tenantId: b.tenantId, userId: b.adminId });
  check("disconnect revokes the Google grant", tokenCalls.some((c) => c.url === "https://oauth2.googleapis.com/revoke" && c.body.includes("token=rt-google-1")));
  check("disconnect removes the stored connection", (await db.select().from(tenantMailSettings).where(eq(tenantMailSettings.tenantId, b.tenantId))).length === 0);
  await throws("after disconnect there is no token to use", () => accessTokenFor(b.tenantId, "google"), /not connected/);
  setHttpForTests(null);

  // ---------------------------------------------------------------- auto-send
  const skipped = await maybeAutoSend(a.tenantId, "00000000-0000-0000-0000-000000000000");
  check("auto-send does nothing while the agency has it off", !skipped.sent && /off/.test(skipped.reason));

  // ---------------------------------------------------------------- cleanup
  await db.delete(tenants).where(inArray(tenants.id, [a.tenantId, b.tenantId]));
  const left = await db.select({ id: users.id }).from(users).where(inArray(users.tenantId, [a.tenantId, b.tenantId]));
  check("cleanup removed both test agencies", left.length === 0);

  console.log(failures ? `\n${failures} check(s) FAILED.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
