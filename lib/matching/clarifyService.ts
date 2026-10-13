/**
 * The clarification exchange, end to end.
 *
 * Two halves that mirror each other:
 *
 *   ASK      an ambiguous request is answered with a question, in its own
 *            thread, and parked at `awaitingRequester`
 *   ANSWER   the reply is recognised as belonging to that request, read, and
 *            used to resolve it
 *
 * The judgement rules live in ./clarify.ts and ./identifier.ts; this file is
 * the part that touches the database and the mail server.
 */

import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { withTenant, type TenantDb } from "@/lib/db/client";
import { coiRequests, producers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { sendReply, DeliveryBlocked, assertDeliverable, AUTO_HEADER } from "@/lib/gmail/send";
import { generateDraft } from "@/lib/certificate/service";
import { withReadingContext } from "@/lib/llm/readingLog";
import { FOLLOW_UP_SEPARATOR, ownWords } from "@/lib/llm/messages";
import { interpret } from "./interpret";
import { resolveByIdentifier } from "./identifier";
import { upsertHolder } from "./holder";
import { readHolder } from "./holderReader";
import {
  clarificationEnabled,
  composeQuestion,
  readClarification,
} from "./clarify";
import type { Candidate } from "./resolve";

export interface ClarifyOutcome {
  asked: boolean;
  reason: string;
}

/** What to put to the requester: which insured, who the holder is, or both. */
export interface AskParts {
  insured?: { askedFor: string; candidates: Candidate[] };
  holder?: boolean;
}

/**
 * Ask the requester which company they meant.
 *
 * Refuses in more cases than it accepts, and every refusal leaves the request
 * exactly where it was — visible to a reviewer, who can still resolve it by
 * hand. Nothing here is load-bearing for correctness; it only saves the
 * reviewer a question they cannot answer.
 */
export async function askRequester(
  tenantId: string,
  requestId: string,
  askedFor: string,
  candidates: Candidate[]
): Promise<ClarifyOutcome> {
  return askRequesterFor(tenantId, requestId, { insured: { askedFor, candidates } });
}

/**
 * Ask for whatever is missing, in ONE message: the insured's USDOT/MC number
 * when the name fits more than one client, the certificate holder when the
 * request named none, or both.
 */
export async function askRequesterFor(
  tenantId: string,
  requestId: string,
  parts: AskParts
): Promise<ClarifyOutcome> {
  if (!clarificationEnabled()) {
    return { asked: false, reason: "clarification disabled by configuration" };
  }
  // Nothing to choose between. If the resolver refused for any other reason,
  // naming a single candidate would be leading the witness.
  let insured = parts.insured && parts.insured.candidates.length >= 2 ? parts.insured : undefined;
  let holder = Boolean(parts.holder);
  if (!insured && !holder) {
    return { asked: false, reason: parts.insured ? "not an ambiguity between two or more insureds" : "nothing to ask" };
  }

  const request = await withTenant(tenantId, async (tx) => {
    const [row] = await tx.select().from(coiRequests).where(eq(coiRequests.id, requestId));
    return row;
  });
  if (!request) return { asked: false, reason: "request not found" };

  // Ask once. A second unanswered question in the same thread reads as a
  // malfunction, and the reviewer path is still open either way.
  if (insured && request.clarificationSentAt) insured = undefined;
  if (holder && request.holderRequestedAt) holder = false;
  if (!insured && !holder) {
    return { asked: false, reason: "already asked" };
  }

  // The same recipient rules that govern certificates. Seeded and reserved
  // domains are refused here too, so demonstration data cannot generate mail.
  try {
    assertDeliverable(request.fromAddr);
  } catch (err) {
    return { asked: false, reason: `cannot email the requester: ${(err as Error).message}` };
  }

  const producerName = await withTenant(tenantId, async (tx) => {
    const [p] = await tx
      .select({ name: producers.name })
      .from(producers)
      .where(eq(producers.isDefault, true))
      .limit(1);
    return p?.name ?? "Certificate Department";
  });

  const text = composeQuestion({ insured, holder, producerName });

  // Sent BEFORE the database records it, for the same reason certificate
  // delivery is: if the send fails, nothing is written and the request stays
  // ambiguous. Recording a question that was never asked would leave it parked
  // waiting for a reply that nobody was invited to send.
  try {
    await sendReply({
      tenantId,
      to: request.fromAddr,
      subject: request.subject ?? "Certificate of insurance request",
      text,
      inReplyTo: request.gmailMessageId,
      threadId: request.gmailThreadId,
      // So ingestion recognises this as our own output and does not read it
      // back as either a new request or an answer to itself.
      headers: { [AUTO_HEADER]: "clarification" },
    });
  } catch (err) {
    if (err instanceof DeliveryBlocked) {
      return { asked: false, reason: err.message };
    }
    throw err;
  }

  await withTenant(tenantId, async (tx) => {
    await tx
      .update(coiRequests)
      .set({
        status: "awaitingRequester",
        // A holder-only question leaves the insured match ("matched") as it
        // was: it is still what auto-send checks once the holder arrives.
        ...(insured ? { clarificationSentAt: new Date(), matchConfidence: "awaitingRequester" } : {}),
        ...(holder ? { holderRequestedAt: new Date() } : {}),
      })
      .where(eq(coiRequests.id, requestId));

    await audit(tx, {
      tenantId,
      actorUserId: null,
      action: insured ? "request.clarification_sent" : "request.holder_requested",
      subjectType: "coi_request",
      subjectId: requestId,
      after: {
        to: request.fromAddr,
        asked: [insured ? "insured" : null, holder ? "holder" : null].filter(Boolean),
        ...(insured
          ? {
              askedFor: insured.askedFor,
              // Names only. The candidates are already implied by what the
              // requester wrote, and the audit log holds no more than it must.
              candidates: insured.candidates.slice(0, 4).map((c) => c.legalName),
            }
          : {}),
      },
    });
  });

  const what = [insured ? "which insured was meant" : "", holder ? "who the certificate holder is" : ""]
    .filter(Boolean)
    .join(" and ");
  return { asked: true, reason: `asked ${request.fromAddr} ${what}` };
}

/**
 * The request an inbound email is answering, if it is answering one.
 *
 * Matched on the Message-IDs the reply references, then on the mail provider's
 * thread id as a fallback. Only requests actually waiting for an answer are
 * considered — a reply to a request that has since been resolved by a reviewer
 * is just correspondence, and turning it back into an open question would undo
 * their work.
 */
/**
 * Any request this email belongs to, whatever state it is in.
 *
 * A REPLY IS NEVER A NEW REQUEST. That is the rule this enforces, and it holds
 * regardless of what has happened to the original since.
 *
 * The case that forced it: the system asked a requester which company they
 * meant, and while waiting a reviewer resolved it by hand from the dashboard.
 * The request left the waiting state. The requester's answer then arrived,
 * matched nothing that was waiting, and was ingested as a fresh request - so
 * the same conversation appeared twice on the dashboard and the reviewer had to
 * resolve it a second time.
 *
 * Matched on the Message-IDs the reply references, then on the mail provider's
 * thread id. A real reply carries both: the id of the message it answers AND
 * the whole chain behind it, which is what reaches back to the original
 * request even when the reply is answering OUR question rather than theirs.
 */
export async function findRequestInThread(
  tx: TenantDb,
  inReplyTo: string[],
  threadId: string | null
): Promise<typeof coiRequests.$inferSelect | null> {
  const ids = inReplyTo.filter(Boolean);
  if (!ids.length && !threadId) return null;

  const conditions = [];
  // inArray, not a hand-written ANY(): passing a JavaScript array into raw SQL
  // sends it as a string, and Postgres rejects it as a malformed array literal.
  if (ids.length) conditions.push(inArray(coiRequests.gmailMessageId, ids));
  if (threadId) conditions.push(eq(coiRequests.gmailThreadId, threadId));

  const [row] = await tx
    .select()
    .from(coiRequests)
    .where(conditions.length === 1 ? conditions[0] : or(...conditions))
    // Oldest first: the original request owns the thread, not a later reply.
    .orderBy(coiRequests.receivedAt)
    .limit(1);

  return row ?? null;
}

/**
 * The MOST RECENT request in the thread.
 *
 * `findRequestInThread` deliberately returns the oldest, because the original
 * request owns the thread and a clarification answers that. A follow-up is the
 * opposite question — "what is the state of this conversation NOW" — and once a
 * thread can hold more than one request, the answer is the latest one. Asking
 * the original would have a second follow-up amend a request that was fulfilled
 * two documents ago.
 */
export async function findLatestInThread(
  tx: TenantDb,
  inReplyTo: string[],
  threadId: string | null
): Promise<typeof coiRequests.$inferSelect | null> {
  const ids = inReplyTo.filter(Boolean);
  if (!ids.length && !threadId) return null;

  const conditions = [];
  if (ids.length) conditions.push(inArray(coiRequests.gmailMessageId, ids));
  if (threadId) conditions.push(eq(coiRequests.gmailThreadId, threadId));

  const [row] = await tx
    .select()
    .from(coiRequests)
    .where(conditions.length === 1 ? conditions[0] : or(...conditions))
    .orderBy(desc(coiRequests.receivedAt))
    .limit(1);

  return row ?? null;
}

/** The request this email answers, only when one is actually waiting on it. */
export async function findAwaitingRequest(
  tx: TenantDb,
  inReplyTo: string[],
  threadId: string | null
): Promise<typeof coiRequests.$inferSelect | null> {
  const row = await findRequestInThread(tx, inReplyTo, threadId);
  return row && row.status === "awaitingRequester" ? row : null;
}

export interface AnswerOutcome {
  resolved: boolean;
  clientName: string | null;
  reason: string;
}

/**
 * Apply a requester's reply to the request it answers.
 *
 * An unusable reply is NOT an error and does not send another question. The
 * request moves to `needsMatch`, which puts it in front of a reviewer with the
 * whole exchange visible — at which point a person can read what the requester
 * actually wrote, which is more than this can do.
 */
export async function applyAnswer(
  tenantId: string,
  request: typeof coiRequests.$inferSelect,
  replyText: string,
  /** The reply's Message-ID, recorded so the same reply is never applied twice. */
  replyMessageId?: string
): Promise<AnswerOutcome> {
  // What the question asked. The insured is missing until a client is linked;
  // the holder is missing when we asked for one and none is linked yet.
  const awaitingInsured = !request.clientId;
  const awaitingHolder = !request.holderId && Boolean(request.holderRequestedAt);

  let clientId: string | null = request.clientId;
  let clientName: string | null = null;
  let how = "";
  let candidates: Candidate[] = [];

  if (awaitingInsured) {
    ({ clientId, clientName, how, candidates } = await answerInsured(tenantId, request, replyText));
  }

  // ---- the certificate holder, when that was asked too ----
  let holderId = request.holderId;
  let holderHow = "";
  if (awaitingHolder) {
    const stated = await withReadingContext({ tenantId, requestId: request.id, messageId: request.gmailMessageId }, () =>
      readHolder(replyText, {
        // A bare name answers the holder question only when it was the ONLY
        // question; alongside "which company?" it could answer either.
        answerToQuestion: !awaitingInsured,
        exclude: candidates.map((c) => c.legalName),
      })
    );
    if (stated) {
      holderId = await withTenant(tenantId, (tx) =>
        upsertHolder(
          tx,
          tenantId,
          { name: stated.name, addressLines: stated.addressLines, source: "stated", evidence: stated.evidence },
          stated.email || null
        )
      );
      holderHow = `certificate holder "${stated.name}" supplied by the requester`;
    } else {
      holderHow = "the reply does not name a certificate holder";
      console.warn(
        `[clarify] no certificate holder in the answer for request ${request.id}\n` +
          `[clarify]   raw reply : ${JSON.stringify(replyText.slice(0, 400))}`
      );
    }
  }

  // The reply joins the request's own text, exactly as a follow-up does. Its
  // instructions then count: "MC 1500002 — and please include the VINs" is a
  // request for VINs, and the VIN reader only ever reads the stored body. Only
  // the requester's own words: our quoted question stays out.
  const own = ownWords(replyText ?? "");
  const bodyText = own ? [request.bodyText, own].filter(Boolean).join(FOLLOW_UP_SEPARATOR) : request.bodyText;

  await withTenant(tenantId, async (tx) => {
    await tx
      .update(coiRequests)
      .set({
        clientId,
        holderId,
        bodyText,
        status: clientId ? "ready" : "needsMatch",
        matchConfidence: awaitingInsured
          ? clientId
            ? "requesterConfirmed"
            : "clarificationUnclear"
          : request.matchConfidence,
      })
      .where(eq(coiRequests.id, request.id));

    await audit(tx, {
      tenantId,
      actorUserId: null,
      action: awaitingInsured
        ? clientId
          ? "request.clarified"
          : "request.clarification_unclear"
        : holderId
          ? "request.holder_supplied"
          : "request.holder_unclear",
      subjectType: "coi_request",
      subjectId: request.id,
      // How it was settled, never the reply text. The body is purgeable and
      // must not be copied into an immutable log. The reply's id is what
      // ingest's alreadyIngested() checks, so a second look at the same reply
      // is recognised instead of being taken for a follow-up.
      after: {
        clientId,
        clientName,
        how: how || null,
        holderId,
        holderHow: holderHow || null,
        messageId: replyMessageId ?? null,
      },
    });
  });

  // Draft it, exactly as polling would have if nothing had been missing.
  //
  // Leaving the request at "ready" with no document would mean the requester
  // answered our question and then still waited for someone to notice — the
  // delay this whole exchange exists to remove. A holder that is STILL missing
  // gives a draft with an empty holder box for a reviewer to complete; auto-send
  // refuses that draft (lib/certificate/autoSend.ts).
  //
  // Never fatal: a drafting failure leaves a matched request a reviewer can
  // open, same as everywhere else.
  if (clientId) {
    try {
      await generateDraft({ tenantId, actorUserId: null }, request.id);
    } catch (err) {
      console.warn(`[clarify] resolved but could not draft: ${(err as Error).message}`);
    }
  }

  return {
    resolved: Boolean(clientId),
    clientName,
    reason: [how, holderHow].filter(Boolean).join("; "),
  };
}

/** Settle WHICH INSURED from a reply — the original clarification exchange. */
async function answerInsured(
  tenantId: string,
  request: typeof coiRequests.$inferSelect,
  replyText: string
): Promise<{ clientId: string | null; clientName: string | null; how: string; candidates: Candidate[] }> {
  // Re-run interpretation on the ORIGINAL request to recover the candidates the
  // question was about. They are not stored: keeping a snapshot of them would
  // go stale against the client list, and re-deriving is cheap and always
  // current.
  const original = await interpret(tenantId, {
    subject: request.subject,
    body: request.bodyText,
  });

  const answer = readClarification(replyText, original.candidates);

  let clientId: string | null = null;
  let clientName: string | null = null;
  let how = "";

  if (answer.kind === "identifier") {
    const match = await resolveByIdentifier(tenantId, answer.identifiers);
    if (match) {
      clientId = match.clientId;
      clientName = match.legalName;
      how = `${match.matchedOn.toUpperCase()} number supplied by the requester`;
    } else {
      how = "the number supplied does not match any insured on our books";
    }
  } else if (answer.kind === "name") {
    clientId = answer.candidate.clientId;
    clientName = answer.candidate.legalName;
    how = "full legal name supplied by the requester";
  } else {
    how = answer.reason;

    // Log what we could not read.
    //
    // The reply is NOT stored anywhere - it is linked to an existing request
    // rather than becoming one - so when this path is taken there is otherwise
    // no record of the text that defeated the reader, and the failure cannot be
    // diagnosed after the fact. Truncated, and only on failure.
    console.warn(
      `[clarify] could not read an answer for request ${request.id}: ${answer.reason}\n` +
        `[clarify]   raw reply : ${JSON.stringify(replyText.slice(0, 400))}\n` +
        `[clarify]   candidates: ${original.candidates.map((c) => c.legalName).join(" | ")}`
    );
  }

  return { clientId, clientName, how, candidates: original.candidates };
}

/** Requests still waiting on a reply, for the dashboard. */
export async function countAwaiting(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({ id: coiRequests.id })
      .from(coiRequests)
      .where(and(eq(coiRequests.status, "awaitingRequester"), isNull(coiRequests.clientId)));
    return rows.length;
  });
}
