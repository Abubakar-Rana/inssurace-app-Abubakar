/**
 * Email in, insured out — the interpretation step, end to end.
 *
 * Runs against the seeded inbox, which is written to include cases the system
 * must REFUSE: a company we don't insure, and an email that never names one.
 * A run where everything matches would mean the thresholds are too loose.
 *
 *   npm run verify:interpretation
 */

import "@/lib/env";
import { asc, eq } from "drizzle-orm";
import { db, withTenant } from "@/lib/db/client";
import { coiRequests, tenants } from "@/db/schema";
import { extractInsuredNames } from "@/lib/matching/extract";
import { interpretRequest } from "@/lib/matching/interpret";
import type { MatchDecision } from "@/lib/matching/resolve";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

/** Keyed by gmailMessageId so order changes don't break the test. */
const EXPECTED: Record<string, { decision: MatchDecision; client?: string; why: string }> = {
  "seed-1": { decision: "matched", client: "Smart Way Solutions Inc", why: "named in the subject" },
  // "Smartway Solutions", which fits BOTH seeded companies equally. This used
  // to match when the agency had one client; with two near-identical names it
  // must not, and the system asks the requester for a USDOT or MC number
  // instead of guessing.
  "seed-2": { decision: "ambiguous", why: "spelling fits both seeded companies" },
  // "Insured: Smart Way Solutions, LLC" — the suffix is what settles it, and it
  // settles it on the LLC rather than the Inc.
  "seed-3": { decision: "matched", client: "Smart Way Solutions LLC", why: "explicit Insured: label" },
  "seed-4": { decision: "noMatch", why: "a carrier we do not insure" },
  "seed-5": { decision: "noMatch", why: "names no company at all" },
};

async function main() {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, "whittington"));
  if (!tenant) throw new Error("Tenant not seeded. Run: npm run db:seed");

  // ---- the sender must never be mistaken for the insured ----
  console.log("sender is not the insured:");
  const senderTrap = extractInsuredNames({
    subject: "Insurance paperwork",
    body:
      "Could you send a certificate of insurance for Smartway Solutions?\n\n" +
      "Regards,\nDana Whitfield\nMidwest Freight Brokers Inc",
  });
  check(
    "  extracts the insured, not the signature",
    senderTrap.length > 0 && senderTrap[0].name.toLowerCase().includes("smartway"),
    senderTrap.map((e) => e.name).join(" | ") || "(nothing extracted)"
  );
  check(
    "  never proposes the sender's company",
    !senderTrap.some((e) => e.name.toLowerCase().includes("midwest")),
    senderTrap.map((e) => e.name).join(" | ")
  );

  // ---- an email that names nobody yields nothing ----
  const silent = extractInsuredNames({
    subject: "Certificate please",
    body: "Can you send the usual certificate over? Same as last time.",
  });
  check("  says nothing when the email names nobody", silent.length === 0, `${silent.length} found`);

  // ---- the seeded inbox ----
  console.log("\ninbox:");
  // Scoped to the seeded fixtures by message id. Once anyone polls a live
  // mailbox, real requests sit in the same table; they have no known expected
  // outcome, so asserting against them would turn a working system into a red
  // test run. They are counted and reported, not judged.
  const all = await withTenant(tenant.id, (tx) =>
    tx.select().from(coiRequests).orderBy(asc(coiRequests.gmailMessageId))
  );
  const requests = all.filter((r) => EXPECTED[r.gmailMessageId]);
  const live = all.length - requests.length;

  check(`  ${requests.length} seeded requests present`, requests.length === Object.keys(EXPECTED).length);
  if (live) console.log(`      (ignoring ${live} real request(s) polled from the mailbox)`);

  for (const request of requests) {
    const expected = EXPECTED[request.gmailMessageId];

    const result = await interpretRequest(tenant.id, request.id);
    const decisionOk = result.decision === expected.decision;
    const clientOk = expected.decision !== "matched" || result.clientName === expected.client;

    check(
      `  ${(request.subject ?? "").slice(0, 42).padEnd(44)} -> ${result.decision.padEnd(9)} (${expected.why})`,
      decisionOk && clientOk,
      decisionOk && clientOk ? (result.usedName ? `read "${result.usedName}"` : "") : result.reason
    );
  }

  // ---- the write-back is what the dashboard reads ----
  console.log("\nrequest state after interpretation:");
  const after = await withTenant(tenant.id, (tx) =>
    tx.select().from(coiRequests).orderBy(asc(coiRequests.gmailMessageId))
  );
  for (const r of after) {
    const expected = EXPECTED[r.gmailMessageId];
    // Real mail polled from the mailbox lives alongside the seeded set once
    // anyone has tested against a live inbox. This script is about the seeded
    // fixtures, whose outcomes are known; skip anything else rather than
    // failing on a request it was never given an expectation for.
    if (!expected) continue;
    // An ambiguous request is either sitting with a reviewer or waiting on the
    // requester, depending on whether asking them was possible. Both are
    // correct outcomes of the same decision.
    const wantStatus =
      expected.decision === "matched" ? "ready" : ["needsMatch", "awaitingRequester"];
    check(
      `  ${r.gmailMessageId} status=${r.status}`,
      Array.isArray(wantStatus) ? wantStatus.includes(r.status) : r.status === wantStatus,
      `expected ${Array.isArray(wantStatus) ? wantStatus.join(" or ") : wantStatus}`
    );
    check(
      `  ${r.gmailMessageId} ${r.clientId ? "linked" : "unlinked"}`,
      expected.decision === "matched" ? Boolean(r.clientId) : r.clientId === null
    );
  }

  const matched = after.filter((r) => r.clientId).length;
  console.log(`\n${matched} of ${after.length} matched automatically; ${after.length - matched} routed to a human.`);

  console.log(failures === 0 ? "\nall interpretation checks passed" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
