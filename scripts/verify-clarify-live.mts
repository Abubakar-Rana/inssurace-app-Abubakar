/**
 * The clarification exchange, against the real mailbox.
 *
 * SENDS REAL MAIL. It emails an AMBIGUOUS request — one naming a company that
 * fits two of the seeded insureds equally — and then checks that the system:
 *
 *   1. refused to guess;
 *   2. emailed the requester a question, in the original thread;
 *   3. parked the request at `awaitingRequester` rather than dropping it;
 *   4. resolved it when the answer came back with an MC number.
 *
 * Step 4 is applied directly rather than by sending a reply. The mailbox we
 * send from is the mailbox we read, so a reply from it would be recognised as
 * our own output and skipped — correctly, since that guard is what stops the
 * system answering itself. What matters is that the same code path runs, with
 * the request the live system actually created.
 *
 * Needs the dev server running, which is what watches the mailbox.
 *
 *   npx next dev -p 3111 &
 *   npm run verify:clarify:live
 */

import "@/lib/env";
import { desc, eq } from "drizzle-orm";
import { db, withTenant } from "@/lib/db/client";
import { coiRequests, tenants } from "@/db/schema";
import { sendReply } from "@/lib/gmail/send";
import { gmailConfigFromEnv } from "@/lib/gmail/inbox";
import { applyAnswer } from "@/lib/matching/clarifyService";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const MARK = `Ambiguous ${Date.now().toString().slice(-6)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * SENDS REAL MAIL — opt in with SEND_REAL_MAIL=1.
 *
 * Guarded because these tests are cheap to run and expensive to have run: each
 * one leaves a permanent message in a real mailbox, and repeated runs during
 * development filled one to capacity. A test that quietly consumes somebody's
 * storage should have to be asked for.
 */
function requireOptIn(name: string): void {
  if (process.env.SEND_REAL_MAIL === "1") return;
  console.log(`\n${name} sends real email and is opt-in.`);
  console.log("Set SEND_REAL_MAIL=1 to run it:\n");
  console.log(`  SEND_REAL_MAIL=1 npm run ${name}\n`);
  process.exit(0);
}

async function main() {
  requireOptIn("verify:clarify:live");

  const config = gmailConfigFromEnv();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, "whittington"));
  if (!tenant) throw new Error("Tenant not seeded. Run: npm run db:seed");

  console.log(`\nsending an AMBIGUOUS request to ${config.user} …`);
  await sendReply({
    to: config.user,
    subject: `COI request - ${MARK}`,
    text: [
      "Hi,",
      "",
      // Fits "Smart Way Solutions Inc" and "Smart Way Solutions LLC" equally.
      "Please send a certificate of insurance for Smartway Solutions.",
      "",
      "Regards,",
      "Dana Whitfield",
      "Carrier Compliance",
      "Redline Freight Brokers Inc",
    ].join("\n"),
  });
  console.log(`  sent. marker: ${MARK}`);
  console.log("  waiting for the running server to ingest and act on it …\n");

  // Poll the database for the request the LIVE system created.
  let request: typeof coiRequests.$inferSelect | undefined;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await sleep(2000);
    // Matched on the marker rather than the whole subject: sendReply prefixes
    // "Re:" when replying, so the stored subject is not the string we passed.
    const recent = await withTenant(tenant.id, (tx) =>
      tx.select().from(coiRequests).orderBy(desc(coiRequests.receivedAt)).limit(20)
    );
    request = recent.find((r) => (r.subject ?? "").includes(MARK));

    // Wait for the request to SETTLE, not merely to be stored.
    //
    // Interpretation writes needsMatch first, and only then does the
    // clarification step decide whether it can ask the requester and flip the
    // status again. Reading the row in between catches a state that is real but
    // transient, and asserting on it tests the timing of two writes rather than
    // the behaviour.
    if (request && (request.clarificationSentAt || request.clientId)) break;
  }

  if (!request) {
    check("the request was ingested", false, "never appeared within 120s");
    process.exit(1);
  }
  check("the request was ingested", true, request.subject ?? "");

  check(
    "it did NOT guess an insured",
    request.clientId === null,
    request.clientId ? "a company was chosen" : "no company chosen"
  );
  check(
    "it asked the requester instead of parking it on a reviewer",
    request.status === "awaitingRequester",
    `status=${request.status}`
  );
  check(
    "the question was recorded as sent",
    Boolean(request.clarificationSentAt),
    request.clarificationSentAt ? String(request.clarificationSentAt) : "not recorded"
  );

  // ---- the answer ----
  console.log("\nthe requester replies with an MC number:\n");

  const answer = await applyAnswer(tenant.id, request, "It's MC 1043790, thanks.");
  check(
    "the MC number resolved the request",
    answer.resolved && answer.clientName === "Smart Way Solutions LLC",
    `${answer.clientName ?? "unresolved"} — ${answer.reason}`
  );

  const [after] = await withTenant(tenant.id, (tx) =>
    tx.select().from(coiRequests).where(eq(coiRequests.id, request!.id))
  );
  check("the request moved to ready", after.status === "ready", `status=${after.status}`);
  check("it is now linked to a company", after.clientId !== null);
  check(
    "the outcome is recorded as requester-confirmed",
    after.matchConfidence === "requesterConfirmed",
    String(after.matchConfidence)
  );

  console.log(failures ? `\n${failures} FAILED\n` : `\nAll checks passed.\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
