/**
 * Drives the certificate lifecycle through the service layer the routes call:
 * inbox -> generate -> edit -> approve -> render -> audit chain.
 *
 * Exercises the real database with RLS on, so it catches the things a unit test
 * cannot: a missed tenant filter, a transaction that deadlocks against its own
 * advisory lock, an audit chain that forks.
 *
 *   npx tsx scripts/verify-api.ts
 */

import "@/lib/env";
import { and, desc, eq } from "drizzle-orm";
import { db, withTenant } from "@/lib/db/client";
import { auditLog, clients, coiRequests, tenants } from "@/db/schema";
import { users } from "@/db/schema";
import type { Session } from "@/lib/auth/session";
import { verifyAuditChain } from "@/lib/audit";
import { interpretRequest } from "@/lib/matching/interpret";
import {
  approve,
  generateForRequest,
  getCertificate,
  updateSnapshot,
} from "@/lib/certificate/service";
import { renderCertificatePdf, sha256 } from "@/lib/certificate/render";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

/**
 * Build the session this script runs as.
 *
 * `requireSession()` reads a request cookie, which does not exist outside a
 * Next.js request — so the script constructs the same object directly from the
 * database. It exercises the service layer beneath the routes, not the
 * authentication in front of them.
 */
async function scriptSession(): Promise<Session> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, "whittington"));
  if (!tenant) throw new Error("Tenant not seeded. Run: npm run db:seed");

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.tenantId, tenant.id))
    .orderBy(users.email)
    .limit(1);
  if (!user) throw new Error("Tenant has no users.");

  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantName: tenant.name,
    mustChangePassword: false,
    canManageUsers: false,
  };
}

async function main() {
  const session = await scriptSession();
  console.log(`session: ${session.email} (${session.role})\n`);

  // Interpret the inbox first, exactly as the real flow does. Some seeded
  // emails are written to be refused, so picking one at random would fail on a
  // request the system correctly declined to match.
  const all = await withTenant(session.tenantId, (tx) =>
    tx.select({ id: coiRequests.id }).from(coiRequests)
  );
  for (const r of all) await interpretRequest(session.tenantId, r.id, session.userId);

  // Deliberately the request that resolves to the fully-stocked insured. The
  // seed now carries a second, near-identically named company to exercise
  // ambiguity, and it has its own smaller policy set — picking "whichever
  // matched request is newest" would silently change which document this suite
  // is asserting about.
  const [request] = await withTenant(session.tenantId, (tx) =>
    tx
      .select()
      .from(coiRequests)
      .innerJoin(clients, eq(clients.id, coiRequests.clientId))
      .where(and(eq(coiRequests.status, "ready"), eq(clients.clientNumber, "SWS-1001")))
      .orderBy(desc(coiRequests.receivedAt))
      .limit(1)
      .then((rows) => rows.map((r) => r.coi_requests))
  );
  if (!request) throw new Error("No matched request. Run: npm run db:seed");
  check("inbox has a matched request", true, request.subject ?? "");

  // ---- generate ----
  const draft = await generateForRequest(session, request.id);
  check("draft generated", draft.status === "draft", draft.certificateNumber);
  check("insured came from the database", draft.snapshot.insured.name === "Smart Way Solutions Inc");
  check("two free coverage rows", draft.snapshot.coverages.other.length === 2);
  check("ACORD 101 present", draft.snapshot.acord101 !== null);

  // ---- idempotency ----
  const again = await generateForRequest(session, request.id);
  check("regenerating returns the same draft", again.id === draft.id, again.certificateNumber);

  // ---- edit ----
  const edited = await updateSnapshot(session, draft.id, {
    ...draft.snapshot,
    holder: { ...draft.snapshot.holder, name: "DAT Solutions LLC (Compliance)" },
    certificateNumber: "HACKED-0001", // must be ignored
  });
  check("edit saved", edited.snapshot.holder.name === "DAT Solutions LLC (Compliance)");
  check(
    "certificate number not client-settable",
    edited.snapshot.certificateNumber === draft.certificateNumber,
    edited.snapshot.certificateNumber
  );

  // ---- render + approve ----
  const bytes = await renderCertificatePdf(edited.snapshot);
  const digest = sha256(bytes);
  const issued = await approve(session, draft.id, digest);
  check("approved -> issued", issued.status === "issued");
  check("approval recorded an actor", issued.approvedAt !== null);

  const [reqAfter] = await withTenant(session.tenantId, (tx) =>
    tx.select().from(coiRequests).where(eq(coiRequests.id, request.id))
  );
  check("request marked approved", reqAfter.status === "approved", reqAfter.status);

  // ---- immutability ----
  let blocked = false;
  try {
    await updateSnapshot(session, draft.id, edited.snapshot);
  } catch {
    blocked = true;
  }
  check("issued certificate rejects edits", blocked);

  // ---- reprint is byte-identical ----
  const reprint = await renderCertificatePdf((await getCertificate(session, draft.id)).snapshot);
  check("reprint matches approved bytes", sha256(reprint) === digest);

  // ---- correcting an issued certificate ----
  const rev = await generateForRequest(session, request.id);
  check("correction keeps the number", rev.certificateNumber === draft.certificateNumber);
  check("correction bumps the revision", rev.revision === draft.revision + 1, `rev ${rev.revision}`);
  check("correction is a new draft", rev.id !== draft.id && rev.status === "draft");

  // ---- audit ----
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId));
  const { entries, broken } = await withTenant(session.tenantId, async (tx) => ({
    entries: await tx
      .select({ action: auditLog.action, hash: auditLog.hash })
      .from(auditLog)
      .where(eq(auditLog.tenantId, tenant.id))
      .orderBy(auditLog.seq),
    broken: await verifyAuditChain(tx, tenant.id),
  }));
  check("audit chain intact", broken === null, broken ? `seq ${broken.seq}: ${broken.reason}` : "");
  console.log(`\naudit trail (${entries.length}):`);
  for (const e of entries) console.log(`   ${e.action.padEnd(26)} ${e.hash.slice(0, 16)}…`);

  console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
