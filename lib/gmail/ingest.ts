/**
 * Turn fetched mail into COI requests, then interpret them.
 *
 * Idempotent by design: the unique index on (tenant, gmailMessageId) means
 * re-polling the same mailbox inserts nothing new. That matters because polling
 * is at-least-once — a crash between fetch and commit, or two pollers running
 * at once, must not produce duplicate requests for one email.
 *
 * Ingestion NEVER decides anything about coverage. It records that a message
 * arrived and hands it to interpretation; interpretation may only choose a
 * client. Everything printed on a certificate is read from that client's own
 * records afterwards.
 *
 * It also decides what is worth recording at all. A mailbox is full of things
 * that are not COI requests, and `classifyEmail` runs BEFORE the insert so
 * they are never stored — see lib/gmail/classify.ts. Skipped subjects come back
 * in the result so a wrong skip is visible on the dashboard, not silent.
 */

import { and, eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { coiRequests } from "@/db/schema";
import { audit } from "@/lib/audit";
import { interpretRequest } from "@/lib/matching/interpret";
import { extractHolder, upsertHolder } from "@/lib/matching/holder";
import { generateDraft, ServiceError } from "@/lib/certificate/service";
import { classifyEmail } from "./classify";
import { followUpAction } from "./followUp";
import {
  applyAnswer,
  askRequester,
  findLatestInThread,
  findRequestInThread,
  type AnswerOutcome,
} from "@/lib/matching/clarifyService";
import { fetchMailbox, type FetchOptions, type InboundEmail } from "./inbox";
import { mailConfigFor } from "@/lib/mail/settings";
import { maybeAutoSend } from "@/lib/certificate/autoSend";

export interface IngestResult {
  /** Messages read from the mailbox. */
  fetched: number;
  /** Of those, how many looked like COI requests. */
  candidates: number;
  /** Not COI requests. Never stored — only counted and named here. */
  skipped: number;
  inserted: number;
  duplicates: number;
  matched: number;
  needsMatch: number;
  /** Drafts assembled without anyone asking. */
  generated: number;
  /** Requesters we asked to say which insured they meant. */
  clarificationsSent: number;
  /** Replies that completed a request we had asked about. */
  answered: number;
  /**
   * Replies that asked for something more in a thread we had already handled
   * -- a reissue with VINs, a corrected holder. Work, not noise.
   */
  followUps: number;
  requests: {
    id: string;
    subject: string | null;
    decision: string;
    clientName: string | null;
    certificateNumber: string | null;
  }[];
  /** What was passed over, so a mis-skip is reviewable rather than invisible. */
  ignored: { subject: string | null; fromAddr: string; reason: string }[];
}

/**
 * Retention clock for the message body (Security L6).
 *
 * The email is raw material for one decision; keeping it beyond that is a
 * liability, not an asset. `purgeAfter` is what a later purge job reads.
 */
const BODY_RETENTION_DAYS = 30;

/**
 * Highest mailbox UID already fetched, per tenant.
 *
 * Purely a performance record — correctness never depends on it. If it is lost,
 * wrong or reset, the worst outcome is that a fetch re-downloads messages the
 * unique index then rejects. That is why it can live in memory.
 */
const watermark = new Map<string, { uid: number; uidValidity: string }>();

/** Insert one email as a request. Returns null when it is already stored. */
/**
 * @param carryOver  For a follow-up in an established thread: the insured the
 *   conversation is already about. "Can you resend with the VINs?" names no
 *   company, so without this the second document would need identifying by
 *   hand even though the first was matched.
 */
async function storeEmail(
  tenantId: string,
  email: InboundEmail,
  carryOver?: { clientId: string | null }
): Promise<string | null> {
  return withTenant(tenantId, async (tx) => {
    const [existing] = await tx
      .select({ id: coiRequests.id })
      .from(coiRequests)
      .where(
        and(eq(coiRequests.tenantId, tenantId), eq(coiRequests.gmailMessageId, email.messageId))
      );
    if (existing) return null;

    const purgeAfter = new Date(Date.now() + BODY_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    // The certificate holder is whoever asked, and the only record of that is
    // the email itself — see lib/matching/holder.ts.
    const holderId = await upsertHolder(
      tx,
      tenantId,
      extractHolder({
        subject: email.subject,
        body: email.body,
        fromAddr: email.fromAddr,
        fromName: email.fromName,
      }),
      email.fromAddr
    );

    const [row] = await tx
      .insert(coiRequests)
      .values({
        tenantId,
        gmailMessageId: email.messageId,
        gmailThreadId: email.threadId,
        fromAddr: email.fromAddr,
        fromName: email.fromName,
        subject: email.subject,
        bodyText: email.body,
        receivedAt: email.receivedAt,
        status: "new",
        clientId: carryOver?.clientId ?? null,
        holderId,
        purgeAfter,
      })
      .onConflictDoNothing()
      .returning({ id: coiRequests.id });

    // Lost a race with a concurrent poller — the other one stored it.
    if (!row) return null;

    await audit(tx, {
      tenantId,
      actorUserId: null,
      action: "request.ingested",
      subjectType: "coi_request",
      subjectId: row.id,
      // Metadata only: the body is purgeable and must never enter an immutable
      // log, or the L6 retention promise becomes impossible to keep.
      after: {
        source: "gmail",
        messageId: email.messageId,
        fromAddr: email.fromAddr,
        subject: email.subject,
      },
    });

    return row.id;
  });
}

/**
 * Interpret one request and, if it resolved, draft its certificate.
 *
 * Drafting is automatic because the reviewer's job is to CHECK the document,
 * not to ask for it. Pressing a button to have the system read rows it has
 * already read adds a step and no judgement. What stays human is everything
 * that leaves the building: issuing and sending.
 *
 * A drafting failure is deliberately not fatal to the poll. The request is
 * interpreted and on the dashboard either way, and losing the whole run of
 * incoming mail because one client's policy data is incomplete would be a much
 * worse trade than one request that opens without a draft.
 */
async function interpretAndDraft(
  tenantId: string,
  requestId: string,
  onVisible?: () => void
): Promise<{
  decision: string;
  clientName: string | null;
  certificateNumber: string | null;
  asked?: boolean;
}> {
  const interpretation = await interpretRequest(tenantId, requestId);

  // The request now exists and is interpreted, so it belongs on screen NOW.
  // Assembling its certificate takes several more database round trips, and
  // making the reviewer wait for that before they can even see the request
  // arrive is the difference between a dashboard that feels live and one that
  // feels slow. The draft follows a moment later and announces itself again.
  onVisible?.();

  if (interpretation.decision !== "matched") {
    // AMBIGUOUS means the email named something that fits two of the agency's
    // clients equally well. A reviewer cannot settle that either — the records
    // do not say which of their own clients a stranger meant — but the
    // requester can, in seconds. So ask them.
    //
    // Never fatal. Every refusal, and any failure to send, leaves the request
    // in front of a reviewer exactly as before.
    let asked = false;
    if (interpretation.decision === "ambiguous" && interpretation.candidates.length >= 2) {
      try {
        const outcome = await askRequester(
          tenantId,
          requestId,
          interpretation.usedName ?? interpretation.extracted[0]?.name ?? "",
          interpretation.candidates
        );
        asked = outcome.asked;
        if (!outcome.asked) console.log(`[clarify] not asking: ${outcome.reason}`);
      } catch (err) {
        console.warn(`[clarify] could not ask the requester: ${(err as Error).message}`);
      }
    }
    return {
      decision: interpretation.decision,
      clientName: null,
      certificateNumber: null,
      asked,
    };
  }

  try {
    const draft = await generateDraft({ tenantId, actorUserId: null }, requestId);
    return {
      decision: interpretation.decision,
      clientName: interpretation.clientName,
      certificateNumber: draft.certificateNumber,
    };
  } catch (err) {
    // Surfaced in the log, not thrown: see above.
    const why = err instanceof ServiceError || err instanceof Error ? err.message : String(err);
    console.warn(`could not draft a certificate for request ${requestId}: ${why}`);
    return {
      decision: interpretation.decision,
      clientName: interpretation.clientName,
      certificateNumber: null,
    };
  }
}

/**
 * Interpret anything still sitting at `new`.
 *
 * A request can be left uninterpreted by a crash between insert and
 * interpretation, or by arriving through some path other than polling. Sweeping
 * them here means "check for new email" always leaves the inbox fully
 * processed, rather than accumulating rows nothing ever looks at again.
 */
async function interpretPending(
  tenantId: string
): Promise<{ matched: number; needsMatch: number; generated: number }> {
  const pending = await withTenant(tenantId, (tx) =>
    tx.select({ id: coiRequests.id }).from(coiRequests).where(eq(coiRequests.status, "new"))
  );

  let matched = 0;
  let needsMatch = 0;
  let generated = 0;
  for (const request of pending) {
    const result = await interpretAndDraft(tenantId, request.id);
    if (result.decision === "matched") matched++;
    else needsMatch++;
    if (result.certificateNumber) generated++;
  }
  return { matched, needsMatch, generated };
}

export interface IngestOptions extends FetchOptions {
  /**
   * Called as soon as a request is stored and interpreted, before its
   * certificate is assembled. The caller uses this to put it on screen
   * immediately rather than after the slower drafting step.
   */
  onRequestVisible?: () => void;
}

/** Fetch, store, and interpret. Safe to run repeatedly. */
export async function ingestGmail(
  tenantId: string,
  options: IngestOptions = {}
): Promise<IngestResult> {
  // Resume from where the last fetch finished, so a check that finds nothing
  // costs one search and no downloads. The watermark is per process and lost on
  // restart; the first fetch after a restart falls back to the date window,
  // which is also what catches anything that arrived while we were down.
  const mark = watermark.get(tenantId);
  // This agency's own mailbox — never another's. See lib/mail/settings.ts.
  const fetched = await fetchMailbox(await mailConfigFor(tenantId), {
    ...options,
    sinceUid: mark?.uid,
  });

  // The server renumbered the mailbox, so the stored UID means nothing. Drop it
  // and let the next call fall back to the date window rather than silently
  // skipping mail that now sits below the old watermark.
  if (mark && mark.uidValidity !== fetched.uidValidity) {
    watermark.delete(tenantId);
  } else if (fetched.highestUid > 0) {
    watermark.set(tenantId, { uid: fetched.highestUid, uidValidity: fetched.uidValidity });
  }

  const emails = fetched.emails;

  const result: IngestResult = {
    fetched: emails.length,
    candidates: 0,
    skipped: 0,
    inserted: 0,
    duplicates: 0,
    matched: 0,
    needsMatch: 0,
    generated: 0,
    clarificationsSent: 0,
    answered: 0,
    followUps: 0,
    requests: [],
    ignored: [],
  };

  for (const email of emails) {
    // Our own output, arriving back because we read the mailbox we send from.
    // Dropped before anything else looks at it: it is neither a request nor an
    // answer, and treating it as either makes the system talk to itself.
    if (email.autoGenerated) {
      result.skipped++;
      result.ignored.push({
        subject: email.subject,
        fromAddr: email.fromAddr,
        reason: "sent by CertFlow itself",
      });
      continue;
    }

    // Does this continue a conversation we already have? Checked BEFORE
    // classification, because a reply saying only "MC 1084463" names no
    // document and would be filtered out as not-a-request — which is true in
    // isolation and wrong in context.
    //
    // Either way it is NOT a new request, so nothing below runs on it.
    const reply = await handleIfReply(tenantId, email);
    if (reply) {
      if (reply.kind === "answered") {
        result.answered++;
        if (reply.outcome.resolved) {
          result.matched++;
          // No-op unless this agency turned auto-send on. See lib/certificate/autoSend.ts.
          await maybeAutoSend(tenantId, reply.requestId);
        } else result.needsMatch++;
      } else if (reply.kind === "duplicate") {
        result.duplicates++;
      } else {
        // A follow-up is work, so it is counted as work and announced like any
        // other arrival. `newInThread` also inserted a row; `amended` changed
        // one that already existed, which is why only the former counts as
        // inserted.
        result.followUps++;
        if (reply.kind === "newInThread") result.inserted++;
        if (reply.outcome.decision === "matched") result.matched++;
        else result.needsMatch++;
        if (reply.outcome.certificateNumber) {
          result.generated++;
          await maybeAutoSend(tenantId, reply.requestId);
        }

        result.requests.push({
          id: reply.requestId,
          subject: reply.subject,
          decision: reply.outcome.decision,
          clientName: reply.outcome.clientName,
          certificateNumber: reply.outcome.certificateNumber,
        });
        options.onRequestVisible?.();
      }
      continue;
    }

    // Filter first. Anything that is not a request is dropped here and never
    // reaches the database, so the retention promise in storeEmail only ever
    // has to cover mail we were actually asked to act on.
    const verdict = classifyEmail(email);
    if (!verdict.isRequest) {
      result.skipped++;
      result.ignored.push({
        subject: email.subject,
        fromAddr: email.fromAddr,
        reason: verdict.reason,
      });
      continue;
    }
    result.candidates++;

    const requestId = await storeEmail(tenantId, email);
    if (!requestId) {
      result.duplicates++;
      continue;
    }
    result.inserted++;

    const outcome = await interpretAndDraft(tenantId, requestId, () =>
      options.onRequestVisible?.()
    );
    if (outcome.decision === "matched") result.matched++;
    else result.needsMatch++;
    if (outcome.certificateNumber) {
      result.generated++;
      await maybeAutoSend(tenantId, requestId);
    }
    if (outcome.asked) result.clarificationsSent++;

    result.requests.push({
      id: requestId,
      subject: email.subject,
      decision: outcome.decision,
      clientName: outcome.clientName,
      certificateNumber: outcome.certificateNumber,
    });
  }

  rememberIgnored(tenantId, result.ignored);

  // Catch anything left unprocessed by an earlier run.
  const swept = await interpretPending(tenantId);
  result.matched += swept.matched;
  result.needsMatch += swept.needsMatch;
  result.generated += swept.generated;

  return result;
}

// ---------------------------------------------------------------------------
// One mailbox, many dashboards.
//
// Every open dashboard polls on its own timer, and a reviewer may have the page
// up in three tabs across two machines. Without coalescing that is three IMAP
// connections per tick against a mailbox that usually has not changed — Gmail
// rate-limits it, and the work is wasted even when it doesn't.
//
// So the mailbox is read at most once per MIN_INTERVAL_MS per tenant. Callers
// arriving while a read is in flight wait for that one instead of starting
// another; callers arriving inside the quiet window get the previous outcome
// replayed, flagged so the dashboard knows not to announce it twice. A failure
// is cached and replayed too — a mailbox that is refusing connections should be
// asked once per window, not once per tab.
//
// PROCESS-LOCAL BY DESIGN. This protects one Node process from its own clients.
// It is not a distributed lock and does not need to be: the unique index on
// (tenant, gmail_message_id) is what actually makes double ingestion harmless,
// and it is enforced by the database no matter how many processes there are.
// ---------------------------------------------------------------------------

// Deliberately small. Dashboards no longer poll — the watcher is effectively
// the only caller, and it already limits itself. What remains is protection
// against an announcement storm, where Gmail raises several notifications in
// quick succession for one delivery: the in-flight coalescing below joins those
// onto one fetch, and this stops the immediate follow-up from starting another.
//
// It was 15s when every open tab polled independently. Leaving it there now
// would just add seconds between a message arriving and a reviewer seeing it.
const MIN_INTERVAL_MS = 750;

type Outcome = { ok: true; result: IngestResult } | { ok: false; error: unknown };

const inFlight = new Map<string, Promise<IngestResult>>();
const lastOutcome = new Map<string, { at: number; outcome: Outcome }>();

export interface SharedIngestResult extends IngestResult {
  /** True when this replays an earlier read rather than reporting a new one. */
  throttled: boolean;
}

export async function ingestGmailShared(
  tenantId: string,
  options: IngestOptions = {}
): Promise<SharedIngestResult> {
  const running = inFlight.get(tenantId);
  // Joining a read already in progress is not throttling — the answer is fresh.
  if (running) return { ...(await running), throttled: false };

  const previous = lastOutcome.get(tenantId);
  if (previous && Date.now() - previous.at < MIN_INTERVAL_MS) {
    if (!previous.outcome.ok) throw previous.outcome.error;
    return { ...previous.outcome.result, throttled: true };
  }

  const run = ingestGmail(tenantId, options);
  inFlight.set(tenantId, run);
  try {
    const result = await run;
    lastOutcome.set(tenantId, { at: Date.now(), outcome: { ok: true, result } });
    return { ...result, throttled: false };
  } catch (error) {
    lastOutcome.set(tenantId, { at: Date.now(), outcome: { ok: false, error } });
    throw error;
  } finally {
    inFlight.delete(tenantId);
  }
}

// ---------------------------------------------------------------------------
// What the filter passed over, kept so a wrong skip is still findable.
//
// With a button, every skipped subject came back in the response and the
// reviewer saw it. With continuous watching that would mean announcing every
// newsletter the agency receives, which is noise and would train them to ignore
// the one that mattered.
//
// So skips are recorded here instead and shown on request. The property that
// matters — "a skip is never silent" — is preserved; what changes is that the
// reviewer pulls it rather than being pushed it.
//
// In memory, capped, and lost on restart. That is acceptable: this is a
// diagnostic aid, not a record. Anything that must survive belongs in the audit
// log, and a message we deliberately never stored has no business there.
// ---------------------------------------------------------------------------

const IGNORED_KEEP = 50;
const recentlyIgnored = new Map<string, IngestResult["ignored"]>();

function rememberIgnored(tenantId: string, ignored: IngestResult["ignored"]): void {
  if (!ignored.length) return;
  const existing = recentlyIgnored.get(tenantId) ?? [];
  recentlyIgnored.set(tenantId, [...ignored, ...existing].slice(0, IGNORED_KEEP));
}

/** Mail the filter passed over recently, newest first. */
export function getRecentlyIgnored(tenantId: string): IngestResult["ignored"] {
  return recentlyIgnored.get(tenantId) ?? [];
}

/**
 * If this email answers a question we asked, apply it and return the outcome.
 *
 * Returns null when it is ordinary mail, which is the common case — so this
 * runs on every message and must stay cheap. It does one indexed lookup, and
 * only when the email actually references something.
 */
type PipelineOutcome = {
  decision: string;
  clientName: string | null;
  certificateNumber: string | null;
};

type ReplyHandling =
  /** Answered the question we asked about which insured was meant. */
  | { kind: "answered"; requestId: string; outcome: AnswerOutcome }
  /** Folded into a request that was still open, and re-drafted. */
  | { kind: "amended"; requestId: string; subject: string | null; outcome: PipelineOutcome }
  /** A fresh ask in a thread whose earlier request was already finished. */
  | { kind: "newInThread"; requestId: string; subject: string | null; outcome: PipelineOutcome }
  /** Already ingested — a re-poll, or a race with another poller. */
  | { kind: "duplicate" };

/**
 * Handle an email that continues a conversation we already know about.
 *
 * Returns null for ordinary mail, which is the common case.
 *
 * A REPLY IS NEVER A NEW REQUEST. Two things can be true of one:
 *
 *   the request is WAITING on it   -> read it and resolve the request
 *   the request is NOT waiting     -> it is follow-up correspondence. Recorded
 *                                     as passed over, never stored as a second
 *                                     request.
 *
 * The second case is the one that bit us. A reviewer resolved a request by hand
 * while the requester was composing their answer; the answer then arrived,
 * found nothing waiting, and appeared on the dashboard as a duplicate of the
 * conversation already sitting there.
 */
async function handleIfReply(
  tenantId: string,
  email: InboundEmail
): Promise<ReplyHandling | null> {
  if (!email.inReplyTo.length && !email.threadId) return null;

  const related = await withTenant(tenantId, (tx) =>
    findRequestInThread(tx, email.inReplyTo, email.threadId)
  );
  if (!related) return null;

  if (related.status === "awaitingRequester") {
    return { kind: "answered", requestId: related.id, outcome: await applyAnswer(tenantId, related, email.body) };
  }

  /**
   * Everything else in the thread is a FOLLOW-UP, and a follow-up is work.
   *
   * A thread does not close when we send a certificate. "Can you resend that
   * with the VINs?", "the holder address is wrong", "we need it dated for
   * March" — all arrive as replies to the mail we sent, and all are requests
   * for a document. They used to be counted as skipped and dropped: never
   * stored, never queued, visible only as one line in the passed-over list.
   *
   * Which of the two paths applies is decided by whether the earlier request
   * is FINISHED, because that is what says whether there is still something to
   * change:
   *
   *   still open  -> AMEND it. Its certificate is a draft, so the new
   *                  instruction can simply be folded in and re-drafted.
   *   finished    -> a NEW request in the same thread. The first ask really
   *                  was fulfilled and its certificate is issued and immutable;
   *                  reopening it would falsify both. A second ask is a second
   *                  document that happens to share a conversation.
   *
   * The state is read from the LATEST request in the thread, not the original —
   * see findLatestInThread.
   */
  const latest =
    (await withTenant(tenantId, (tx) =>
      findLatestInThread(tx, email.inReplyTo, email.threadId)
    )) ?? related;

  if (followUpAction(latest.status) === "amend") {
    const outcome = await amendRequest(tenantId, latest, email);
    return { kind: "amended", requestId: latest.id, subject: latest.subject, outcome };
  }

  // Carries the insured forward, so a follow-up that names no company is still
  // drafted rather than landing in front of a reviewer to be re-identified.
  const requestId = await storeEmail(tenantId, email, { clientId: latest.clientId });
  if (!requestId) return { kind: "duplicate" };

  const outcome = await interpretAndDraft(tenantId, requestId);
  return { kind: "newInThread", requestId, subject: email.subject, outcome };
}

/**
 * Fold a follow-up into a request that is still open.
 *
 * The new text is APPENDED rather than replacing the original: the first
 * message says which company and who the holder is, the second says what to
 * change. Interpretation and the VIN reader both read `bodyText`, so appending
 * is what makes "please include the VINs" take effect on the re-draft.
 *
 * `viewedAt` is cleared so the request returns to the unread count — a reviewer
 * who already looked at it needs to know it has changed since.
 */
async function amendRequest(
  tenantId: string,
  request: typeof coiRequests.$inferSelect,
  email: InboundEmail
): Promise<{ decision: string; clientName: string | null; certificateNumber: string | null }> {
  await withTenant(tenantId, async (tx) => {
    await tx
      .update(coiRequests)
      .set({
        bodyText: [request.bodyText, email.body].filter(Boolean).join("\n\n---\n\n"),
        viewedAt: null,
        purgeAfter: new Date(Date.now() + BODY_RETENTION_DAYS * 24 * 60 * 60 * 1000),
      })
      .where(eq(coiRequests.id, request.id));

    await audit(tx, {
      tenantId,
      actorUserId: null,
      action: "request.followed_up",
      subjectType: "coi_request",
      subjectId: request.id,
      before: { status: request.status },
      // Metadata only — the body is purgeable and never enters the audit log.
      after: { from: email.fromAddr, messageId: email.messageId },
    });
  });

  return interpretAndDraft(tenantId, request.id);
}
