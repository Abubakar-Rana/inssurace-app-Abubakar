/**
 * Delivery guardrails.
 *
 * Sending is the one irreversible action in the system: a certificate that
 * reaches a holder cannot be recalled, and they will rely on it. So most of
 * this file tests REFUSAL — drafts, demo addresses, and (outside production)
 * anything that is not our own mailbox.
 *
 * It sends no mail. The one real send is covered by scripts/verify-delivery-live.ts,
 * which is opt-in because it emails a real inbox.
 *
 *   npm run verify:delivery
 */

import "@/lib/env";
import { desc, eq } from "drizzle-orm";
import { db, withTenant } from "@/lib/db/client";
import { certificates, coiRequests, tenants, users } from "@/db/schema";
import { assertDeliverable, DeliveryBlocked } from "@/lib/gmail/send";
import { deliverCertificate } from "@/lib/certificate/deliver";
import { generateForRequest } from "@/lib/certificate/service";
import { interpretRequest } from "@/lib/matching/interpret";
import type { Session } from "@/lib/auth/session";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

/** Run `fn` and report whether it refused, and why. */
async function refuses(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, "it went through — nothing was refused");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    check(label, true, message.slice(0, 96));
  }
}

async function main() {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, "whittington"));
  if (!tenant) throw new Error("Tenant not seeded. Run: npm run db:seed");
  const [user] = await db.select().from(users).where(eq(users.tenantId, tenant.id)).limit(1);

  const session: Session = {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };

  // ---- address rules, no database involved ----
  //
  // These cases set DELIVERY_ALLOWLIST themselves, so they prove what the code
  // does rather than what this machine's .env.local happens to say. The real
  // value is put back before the lifecycle section.
  console.log("recipient rules:");
  const owner = process.env.GMAIL_USER ?? "";
  const configured = process.env.DELIVERY_ALLOWLIST;
  delete process.env.DELIVERY_ALLOWLIST;

  refuseSync("  rejects a malformed address", () => assertDeliverable("not-an-address"));
  refuseSync("  rejects the seeded demo domain", () => assertDeliverable("certs@datsolutions.example"));
  refuseSync("  rejects .invalid", () => assertDeliverable("someone@nowhere.invalid"));
  refuseSync("  rejects a stranger outside production", () => assertDeliverable("stranger@gmail.com"));

  try {
    assertDeliverable(owner);
    check("  allows the configured mailbox", true, owner);
  } catch (err) {
    check("  allows the configured mailbox", false, (err as Error).message);
  }

  // An allowlist widens it deliberately.
  process.env.DELIVERY_ALLOWLIST = "ops@acme.test-real.com,@partner.test-real.com";
  try {
    assertDeliverable("ops@acme.test-real.com");
    assertDeliverable("anyone@partner.test-real.com");
    check("  allowlist admits exact addresses and @domains", true);
  } catch (err) {
    check("  allowlist admits exact addresses and @domains", false, (err as Error).message);
  }
  refuseSync("  allowlist still excludes others", () => assertDeliverable("nope@elsewhere.com"));

  // "*" is how an agency taking real requests runs: the requester's address is
  // not something we can enumerate in advance.
  process.env.DELIVERY_ALLOWLIST = "*";
  try {
    assertDeliverable("whoever@wrote.test-real.com");
    check("  '*' admits any real address", true);
  } catch (err) {
    check("  '*' admits any real address", false, (err as Error).message);
  }
  // ...but it is an allowlist, not an off switch. Demo data still cannot be
  // emailed, which is the check that stops a click on seeded rows.
  refuseSync("  '*' still refuses reserved domains", () =>
    assertDeliverable("certs@datsolutions.example")
  );
  refuseSync("  '*' still refuses malformed addresses", () => assertDeliverable("bad@@x"));

  // Back to whatever the environment actually configures.
  if (configured === undefined) delete process.env.DELIVERY_ALLOWLIST;
  else process.env.DELIVERY_ALLOWLIST = configured;

  // ---- lifecycle rules ----
  console.log("\nlifecycle:");

  const all = await withTenant(tenant.id, (tx) =>
    tx.select({ id: coiRequests.id }).from(coiRequests)
  );
  for (const r of all) await interpretRequest(tenant.id, r.id, session.userId);

  const [ready] = await withTenant(tenant.id, (tx) =>
    tx
      .select()
      .from(coiRequests)
      .where(eq(coiRequests.status, "ready"))
      .orderBy(desc(coiRequests.receivedAt))
      .limit(1)
  );
  if (!ready) throw new Error("No matched request; run npm run db:seed");

  const draft = await generateForRequest(session, ready.id);
  check("  draft generated", draft.status === "draft", draft.certificateNumber);

  await refuses("  refuses to send a draft", () => deliverCertificate(session, draft.id));

  // Issue it without going through approve(), which would render a PDF.
  await withTenant(tenant.id, (tx) =>
    tx.update(certificates).set({ status: "issued" }).where(eq(certificates.id, draft.id))
  );

  // Now the block is the recipient, not the status. Forced to the narrow
  // default for this one check: it is asserting that an unconfigured install
  // cannot email a stranger, which is a property of the code and must not
  // depend on what this machine's .env.local says.
  //
  // The recipient is passed explicitly rather than taken from the request. Real
  // mail now reaches this database — including, after `npm run verify:autopoll`,
  // messages the mailbox sent to itself — so "whoever the newest request came
  // from" is sometimes GMAIL_USER, which the narrow default is supposed to
  // allow. Naming a stranger tests the property instead of the fixture.
  const live = process.env.DELIVERY_ALLOWLIST;
  delete process.env.DELIVERY_ALLOWLIST;
  await refuses("  unconfigured, refuses a stranger's address", () =>
    deliverCertificate(session, draft.id, "stranger@somewhere-else.com")
  );
  if (live === undefined) delete process.env.DELIVERY_ALLOWLIST;
  else process.env.DELIVERY_ALLOWLIST = live;

  // ...and with "*" the same send is allowed through to the recipient rules.
  // It still fails, but on the hash/SMTP path, never on "who is this person".
  process.env.DELIVERY_ALLOWLIST = "*";
  try {
    assertDeliverable("compliance@northstarlogistics.com");
    check("  '*' lets a real requester through the address check", true);
  } catch (err) {
    check("  '*' lets a real requester through the address check", false, (err as Error).message);
  }
  if (live === undefined) delete process.env.DELIVERY_ALLOWLIST;
  else process.env.DELIVERY_ALLOWLIST = live;

  await refuses("  refuses an unknown certificate", () =>
    deliverCertificate(session, "00000000-0000-0000-0000-000000000000")
  );

  await refuses("  refuses when no recipient can be determined", () =>
    deliverCertificate(session, draft.id, "   ")
  );

  console.log(`\n${failures === 0 ? "all delivery guardrails hold" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

/** Synchronous variant of `refuses`. */
function refuseSync(label: string, fn: () => void) {
  try {
    fn();
    check(label, false, "it went through — nothing was refused");
  } catch (err) {
    check(label, err instanceof DeliveryBlocked, (err as Error).message.slice(0, 90));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
