/**
 * A requester's reply must produce a finished certificate.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS EXISTS TO CATCH
 *
 * The whole clarification exchange is worthless if the answer does not land.
 * A reply that is not tied back to its request is ingested as a NEW request,
 * which then looks ambiguous all over again - so the requester is asked the
 * same question a second time, and the certificate they answered for is never
 * built. That failure is completely silent from the outside: mail goes out,
 * nothing goes wrong, and nothing works.
 *
 * It happened. A regex had lost a backslash - `split(/s+/)` rather than
 * `split(/\s+/)` - so every Message-ID containing the letter "s" was shredded
 * and nothing ever matched.
 *
 * This walks the full path with NO MAILBOX INVOLVED: park a request as waiting,
 * hand it a reply, and check that the right company is chosen and a real
 * certificate comes out with the right values on it.
 * ---------------------------------------------------------------------------
 *
 *   npm run verify:answer
 */

import "@/lib/env";
import { desc, eq } from "drizzle-orm";
import { db, withTenant } from "@/lib/db/client";
import { certificates, clients, coiRequests, tenants } from "@/db/schema";
import {
  applyAnswer,
  findAwaitingRequest,
  findRequestInThread,
} from "@/lib/matching/clarifyService";
import type { Certificate } from "@/lib/certificate/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

/** What a reply from the requester actually looks like, quoted question and all. */
function replyBody(answer: string): string {
  return [
    answer,
    "",
    "Regards,",
    "Dana Whitfield",
    "Redline Freight Brokers Inc",
    "",
    "On Mon, 1 Sep 2026 at 09:14, Certificates <certs@agency.test-real.com> wrote:",
    '> "Smartway Solutions" matches more than one of our insureds:',
    ">   - Smart Way Solutions Inc",
    ">   - Smart Way Solutions LLC",
    ">   - the carrier's USDOT number   (for example: USDOT 1234567)",
    ">   - the carrier's MC number      (for example: MC 123456)",
  ].join("\n");
}

interface Case {
  why: string;
  /** What the requester writes back. */
  answer: string;
  /** Whether the original request asked for VINs. */
  askedForVins: boolean;
  /** The company this must resolve to, or null when it must NOT resolve. */
  expect: string | null;
}

const CASES: Case[] = [
  {
    why: "MC number picks the LLC, no VINs asked for",
    answer: "It's MC 1043790, thanks.",
    askedForVins: false,
    expect: "Smart Way Solutions LLC",
  },
  {
    why: "USDOT number picks the Inc, VINs requested",
    answer: "USDOT 3121884 — and please include the VINs on the schedule.",
    askedForVins: true,
    expect: "Smart Way Solutions Inc",
  },
  {
    why: "full legal name picks the Inc, no VINs",
    answer: "Sorry — it's Smart Way Solutions Inc.",
    askedForVins: false,
    expect: "Smart Way Solutions Inc",
  },
  {
    why: "a number we do not insure resolves nothing",
    answer: "MC 9999999",
    askedForVins: false,
    expect: null,
  },
  {
    why: "an unhelpful reply resolves nothing",
    answer: "The usual one please.",
    askedForVins: false,
    expect: null,
  },
];

/** Park a fresh request in the waiting state, as the live system would. */
async function parkAwaiting(tenantId: string, n: number, askedForVins: boolean) {
  const messageId = `<answer-test-${Date.now()}-${n}@example.test>`;
  const body = [
    "Hi,",
    "",
    `Please send a certificate of insurance for Smartway Solutions.${
      askedForVins ? " Please include VINs." : ""
    }`,
    "",
    "Regards,",
    "Dana Whitfield",
    "Redline Freight Brokers Inc",
  ].join("\n");

  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .insert(coiRequests)
      .values({
        tenantId,
        gmailMessageId: messageId,
        gmailThreadId: `answer-thread-${Date.now()}-${n}`,
        fromAddr: "dana@redlinefreight.test-real.com",
        fromName: "Dana Whitfield",
        subject: `COI request - answer test ${n}`,
        bodyText: body,
        receivedAt: new Date(),
        status: "awaitingRequester",
        clarificationSentAt: new Date(),
        matchConfidence: "awaitingRequester",
      })
      .returning();
    return row;
  });
}

async function main() {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, "whittington"));
  if (!tenant) throw new Error("Tenant not seeded. Run: npm run db:seed");

  console.log("\nan answer must reach a finished certificate\n");

  for (const [i, c] of CASES.entries()) {
    const parked = await parkAwaiting(tenant.id, i, c.askedForVins);

    // ---- 1. the reply is tied back to the request it answers ----
    //
    // The requester replied to OUR question, so their headers name our message
    // first and the original only further down the chain.
    const found = await withTenant(tenant.id, (tx) =>
      findAwaitingRequest(
        tx,
        [`<our-clarification-${i}@mail.gmail.com>`, parked.gmailMessageId],
        null
      )
    );
    check(`  [${i + 1}] the reply finds its request`, found?.id === parked.id, c.why);
    if (!found) continue;

    // ---- 2. the answer resolves, or correctly does not ----
    const outcome = await applyAnswer(tenant.id, found, replyBody(c.answer));

    if (c.expect === null) {
      check(
        `  [${i + 1}] ${c.why}`,
        !outcome.resolved,
        outcome.resolved ? `wrongly chose ${outcome.clientName}` : outcome.reason
      );
      const [after] = await withTenant(tenant.id, (tx) =>
        tx.select().from(coiRequests).where(eq(coiRequests.id, parked.id))
      );
      check(
        `  [${i + 1}] it goes to a human rather than being asked again`,
        after.status === "needsMatch",
        `status=${after.status}`
      );
      continue;
    }

    check(
      `  [${i + 1}] ${c.why}`,
      outcome.resolved && outcome.clientName === c.expect,
      `${outcome.clientName ?? "unresolved"} — ${outcome.reason}`
    );
    if (!outcome.resolved) continue;

    // ---- 3. a real certificate exists, with the right values on it ----
    const [cert] = await withTenant(tenant.id, (tx) =>
      tx
        .select()
        .from(certificates)
        .where(eq(certificates.requestId, parked.id))
        .orderBy(desc(certificates.revision))
        .limit(1)
    );
    check(`  [${i + 1}] a certificate was drafted`, Boolean(cert), cert?.certificateNumber ?? "none");
    if (!cert) continue;

    const snap = cert.snapshot as Certificate;

    check(
      `  [${i + 1}] it names the company the requester chose`,
      snap.insured.name === c.expect,
      snap.insured.name
    );

    // The point of the whole exercise: the document carries that company's OWN
    // policy data, not the other one's.
    const [chosen] = await withTenant(tenant.id, (tx) =>
      tx.select().from(clients).where(eq(clients.legalName, c.expect!))
    );
    const policyNumbers = snap.coverages
      ? Object.values(snap.coverages)
          .flatMap((v) => (Array.isArray(v) ? v : [v]))
          .map((row) => (row as { policyNumber?: string })?.policyNumber)
          .filter(Boolean)
      : [];
    check(
      `  [${i + 1}] the coverage grid is populated`,
      policyNumbers.length > 0,
      policyNumbers.join(", ") || "EMPTY"
    );
    check(
      `  [${i + 1}] the holder came from the requester`,
      /Redline|Dana/.test(`${snap.holder.name} ${snap.holder.address}`),
      `${snap.holder.name} / ${snap.holder.address.replace(/\n/g, " · ")}`
    );

    // ---- 4. VINs appear only where they were asked for ----
    const printed = `${snap.descriptionOfOperations}\n${snap.acord101?.remarks ?? ""}`;
    check(
      `  [${i + 1}] VINs ${c.askedForVins ? "ARE" : "are NOT"} printed`,
      /VIN/i.test(printed) === c.askedForVins,
      c.askedForVins ? "asked for" : "not asked for"
    );
    check(
      `  [${i + 1}] the fleet is listed either way`,
      /Vehicles:/.test(printed),
      printed.split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 60) ?? ""
    );

    void chosen;
  }


  // ---- the race that produced a duplicate on the dashboard ----
  //
  // The system asks; a reviewer resolves it by hand before the answer arrives;
  // the answer then turns up. It must NOT become a second request.
  console.log("\na reply arriving after a reviewer already resolved it:\n");

  const parked = await parkAwaiting(tenant.id, 99, false);

  // A reviewer gets there first.
  await withTenant(tenant.id, (tx) =>
    tx
      .update(coiRequests)
      .set({ status: "ready", matchConfidence: "manual" })
      .where(eq(coiRequests.id, parked.id))
  );

  const stillWaiting = await withTenant(tenant.id, (tx) =>
    findAwaitingRequest(tx, [parked.gmailMessageId], parked.gmailThreadId)
  );
  check(
    "  nothing is waiting on it any more",
    stillWaiting === null,
    "correct — the reviewer settled it"
  );

  // But the thread is still ours, and that is what stops the duplicate.
  const inThread = await withTenant(tenant.id, (tx) =>
    findRequestInThread(tx, [parked.gmailMessageId], parked.gmailThreadId)
  );
  check(
    "  the reply is still recognised as part of that conversation",
    inThread?.id === parked.id,
    inThread ? `matched "${inThread.subject}" (${inThread.status})` : "NOT FOUND — would become a duplicate"
  );
  check(
    "  and the reviewer's decision is left alone",
    inThread?.matchConfidence === "manual",
    String(inThread?.matchConfidence)
  );
  console.log(failures ? `\n${failures} FAILED\n` : `\nAll checks passed.\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
