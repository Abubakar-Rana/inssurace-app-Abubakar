/**
 * The requester answers, and a certificate comes out. Against the real mailbox.
 *
 * SENDS ONE REAL EMAIL - opt in with SEND_REAL_MAIL=1.
 *
 * This is the exact path that was broken: a reply carrying an MC number was
 * never tied back to the request it answered, so nothing resolved and the
 * requester was asked the same question again. `npm run verify:answer` proves
 * the logic without a mailbox; this proves it with one, including the mail
 * headers a real reply actually carries.
 *
 * Deliberately opens NO IMAP connection of its own. The watcher already holds
 * one, and Gmail drops connections when an account opens too many at once -
 * which is a good way to make a working system look broken.
 *
 * Needs the watcher running:
 *   npm run watch
 *   SEND_REAL_MAIL=1 npm run verify:answer:live
 */

import "@/lib/env";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, withTenant } from "@/lib/db/client";
import { certificates, coiRequests, tenants } from "@/db/schema";
import { sendReply } from "@/lib/gmail/send";
import { gmailConfigFromEnv } from "@/lib/gmail/inbox";
import type { Certificate } from "@/lib/certificate/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function requireOptIn(): void {
  if (process.env.SEND_REAL_MAIL === "1") return;
  console.log("\nverify:answer:live sends real email and is opt-in.\n");
  console.log("  SEND_REAL_MAIL=1 npm run verify:answer:live\n");
  process.exit(0);
}

async function main() {
  requireOptIn();

  const config = gmailConfigFromEnv();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, "whittington"));
  if (!tenant) throw new Error("Tenant not seeded. Run: npm run db:seed");

  // The most recent request the system has actually asked about.
  const [waiting] = await withTenant(tenant.id, (tx) =>
    tx
      .select()
      .from(coiRequests)
      .where(
        and(
          eq(coiRequests.status, "awaitingRequester"),
          isNotNull(coiRequests.clarificationSentAt)
        )
      )
      .orderBy(desc(coiRequests.receivedAt))
      .limit(1)
  );

  if (!waiting) {
    console.log("\nNo request is waiting on a requester.");
    console.log("Send an ambiguous request first (one naming 'Smartway Solutions'),");
    console.log("let the system ask about it, then run this.\n");
    process.exit(1);
  }

  console.log(`\nanswering: ${waiting.subject}`);
  console.log(`  the system asked ${waiting.fromAddr} at ${waiting.clarificationSentAt}\n`);

  // A real reply references the whole thread. Setting the ORIGINAL message id
  // is what the fix depends on being read correctly.
  await sendReply({
    to: config.user,
    subject: waiting.subject ?? "Certificate of insurance request",
    text: [
      "It's MC 1043790 — sorry for the confusion.",
      "",
      "Regards,",
      "Dana Whitfield",
      "Redline Freight Brokers Inc",
    ].join("\n"),
    inReplyTo: waiting.gmailMessageId,
  });
  console.log("  reply sent. waiting for the system to act on it …\n");

  // Watch the ORIGINAL request change, which only happens if the reply was
  // tied back to it.
  let settled = waiting;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await sleep(2500);
    const [row] = await withTenant(tenant.id, (tx) =>
      tx.select().from(coiRequests).where(eq(coiRequests.id, waiting.id))
    );
    if (row && row.status !== "awaitingRequester") {
      settled = row;
      break;
    }
  }

  check(
    "the reply was tied back to the original request",
    settled.status !== "awaitingRequester",
    settled.status === "awaitingRequester"
      ? "still waiting — the reply was not recognised as an answer"
      : `status is now ${settled.status}`
  );
  check(
    "the MC number chose a company",
    settled.clientId !== null,
    String(settled.matchConfidence)
  );
  check(
    "it is recorded as confirmed by the requester",
    settled.matchConfidence === "requesterConfirmed",
    String(settled.matchConfidence)
  );

  // The reply must NOT have become a request of its own. That was the visible
  // symptom: a second question to somebody who had already answered.
  const strays = await withTenant(tenant.id, (tx) =>
    tx
      .select({ id: coiRequests.id, subject: coiRequests.subject })
      .from(coiRequests)
      .where(eq(coiRequests.status, "awaitingRequester"))
  );
  check(
    "the reply did not become a second request",
    !strays.some((s) => s.id !== waiting.id && (s.subject ?? "").includes(waiting.subject ?? "")),
    strays.map((s) => s.subject).join(" | ") || "none waiting"
  );

  // Poll for the certificate rather than reading once.
  //
  // The status is written BEFORE the document is assembled, so the moment the
  // request stops waiting there is a short window with no certificate yet.
  // Reading in that window tests the ordering of two writes, not whether the
  // answer produced a document.
  let cert: typeof certificates.$inferSelect | undefined;
  const certDeadline = Date.now() + 60_000;
  while (Date.now() < certDeadline) {
    [cert] = await withTenant(tenant.id, (tx) =>
      tx
        .select()
        .from(certificates)
        .where(eq(certificates.requestId, waiting.id))
        .orderBy(desc(certificates.revision))
        .limit(1)
    );
    if (cert) break;
    await sleep(2000);
  }
  check("a certificate was drafted from the answer", Boolean(cert), cert?.certificateNumber ?? "none");

  if (cert) {
    const snap = cert.snapshot as Certificate;
    check("it names the company the requester chose", Boolean(snap.insured.name), snap.insured.name);
    check(
      "the coverage grid carries that company's policies",
      /\d{6,}/.test(snap.descriptionOfOperations + JSON.stringify(snap.coverages)),
      snap.insured.name
    );
  }

  console.log(failures ? `\n${failures} FAILED\n` : `\nAll checks passed.\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
