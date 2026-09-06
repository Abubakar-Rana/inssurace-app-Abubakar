/**
 * Decide whether an inbound email is a COI request at all.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * A shared agency mailbox receives everything: renewal notices, loss runs,
 * newsletters, calendar invites, spam, and — occasionally — a request for a
 * certificate. Ingesting all of it would put the whole mailbox on the dashboard
 * and in the database, which is wrong twice over. It buries the work a reviewer
 * actually has to do, and it stores the contents of unrelated correspondence
 * for thirty days on a promise we made about COI requests specifically.
 *
 * So the filter runs BEFORE the insert. Mail that is not a request is never
 * written down at all — the cheapest possible answer to "what did you do with
 * my email?" is "we never kept it".
 *
 * PRECISION OVER RECALL, WITH THE MISSES VISIBLE. A false positive costs a
 * reviewer a glance; a false negative loses a customer's request. Neither is
 * free, so the threshold is set to admit anything that plainly mentions a
 * certificate, and every skipped subject is reported back to the caller so a
 * miss shows up in the UI rather than vanishing. GMAIL_INGEST_ALL=1 disables
 * the filter entirely when you need to see what the mailbox really contains.
 *
 * No AI. Patterns over text, same as lib/matching/extract.ts, and replaceable
 * by a model later behind the same "email in, verdict out" contract.
 * ---------------------------------------------------------------------------
 */

import { extractInsuredNames } from "@/lib/matching/extract";

export interface ClassifyInput {
  subject?: string | null;
  body?: string | null;
  fromAddr?: string | null;
}

export interface Classification {
  /** True when this should become a coi_request. */
  isRequest: boolean;
  /** Accumulated evidence. Compared against THRESHOLD. */
  score: number;
  /** Human-readable, shown in the UI and written to the audit metadata. */
  reason: string;
  /** Which signals fired, strongest first. */
  signals: string[];
}

/**
 * How much evidence admits an email.
 *
 * Calibrated so that one unambiguous mention of a certificate of insurance is
 * enough on its own, but insurance vocabulary alone is not — a renewal notice
 * says "policy" and "coverage" constantly without asking for anything.
 */
const THRESHOLD = 0.9;

/**
 * Senders that cannot receive a reply.
 *
 * This is not a spam filter — it is the delivery constraint stated in advance.
 * We answer a request by replying in its own thread, so an address that bounces
 * or discards replies cannot be the origin of a request we can fulfil, however
 * insurance-flavoured its subject line is.
 */
const UNREPLYABLE = /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer[-_.]?daemon|postmaster|bounces?|auto[-_.]?(?:reply|confirm))\b/i;

/** Machine-generated mail that quotes the original subject back at us. */
const AUTOMATED_SUBJECT =
  /\b(?:out of (?:the )?office|automatic reply|auto[- ]?reply|delivery status notification|undeliverable|mail delivery (?:failed|subsystem)|read receipt|unsubscribe|verification code|security alert|sign[- ]?in attempt|password reset|one[- ]time (?:code|password))\b/i;

/** Signals, strongest first. Each fires at most once. */
const SIGNALS: { id: string; weight: number; re: RegExp }[] = [
  // Unambiguous: the document is named.
  { id: "certificate of insurance", weight: 1.0, re: /certificates?\s+of\s+(?:liability\s+)?insurance/i },
  { id: "insurance certificate", weight: 1.0, re: /insurance\s+certificates?/i },
  // "COI" as a word — \b keeps it off "coin", "coil", "coincide".
  { id: "COI", weight: 0.9, re: /\bc\.?o\.?i\.?s?\b/i },
  // The form itself, by name or number. "ACORD" is an insurance-standards body
  // whose acronym appears in essentially no other context, so it stands alone.
  { id: "ACORD form", weight: 1.0, re: /\bacord\s*(?:25|101|form|certificate)?\b/i },
  { id: "certificate holder", weight: 0.6, re: /certificate\s+holders?\b/i },
  { id: "additional insured", weight: 0.5, re: /additional\s+insured\b/i },
  // Insurance vocabulary next to a request verb. Neither half is enough alone.
  {
    id: "asks for proof of coverage",
    weight: 0.5,
    re: /(?:request|need|require|send|provide|forward|issue|obtain|attach|email|furnish|updated?|current|renew\w*)[\s\S]{0,60}?(?:proof of (?:insurance|coverage)|evidence of (?:insurance|coverage)|insurance|coverage|liability|umbrella|workers'?\s*comp)/i,
  },
  // Weak on its own; enough to tip something that already scored.
  { id: "certificate", weight: 0.3, re: /\bcertificates?\b/i },
];

/**
 * Classify one email.
 *
 * Pure: no database, no network, no clock. Safe to unit-test and safe to call
 * on every message in a poll.
 */
export function classifyEmail(email: ClassifyInput): Classification {
  if (process.env.GMAIL_INGEST_ALL === "1") {
    return {
      isRequest: true,
      score: THRESHOLD,
      reason: "Filtering disabled (GMAIL_INGEST_ALL=1).",
      signals: [],
    };
  }

  const from = (email.fromAddr ?? "").trim();
  const local = from.split("@")[0] ?? "";
  if (UNREPLYABLE.test(local)) {
    return {
      isRequest: false,
      score: 0,
      reason: `Sent from ${from || "an unreplyable address"}, which cannot receive the certificate.`,
      signals: [],
    };
  }

  const subject = email.subject ?? "";
  if (AUTOMATED_SUBJECT.test(subject)) {
    return {
      isRequest: false,
      score: 0,
      reason: "Automated notification, not a request from a person.",
      signals: [],
    };
  }

  // The signature block is cut for the same reason extract.ts cuts it: an
  // insurance agency's own footer would otherwise make every email it receives
  // look like it is about insurance.
  const body = (email.body ?? "").split(
    /^\s*(?:--+|thanks[,!.]?|thank you[,!.]?|regards[,!.]?|best regards[,!.]?|sincerely[,!.]?)\s*$/imu
  )[0];

  // The subject carries the intent, so it is worth double. Scanned separately
  // rather than concatenated so a signal can say where it fired.
  let score = 0;
  const signals: string[] = [];

  for (const signal of SIGNALS) {
    const inSubject = signal.re.test(subject);
    const inBody = signal.re.test(body);
    if (!inSubject && !inBody) continue;
    score += inSubject ? signal.weight : signal.weight * 0.85;
    signals.push(`${signal.id} (${inSubject ? "subject" : "body"})`);
  }

  // Naming a company in "COI for X" phrasing is itself strong evidence, and it
  // is the exact phrasing the extractor downstream is built to read.
  const named = extractInsuredNames({ subject, body });
  if (named.length) {
    score += 0.6;
    signals.push(`names an insured ("${named[0].name}")`);
  }

  const isRequest = score >= THRESHOLD;

  return {
    isRequest,
    score: Math.round(score * 100) / 100,
    reason: isRequest
      ? signals.join("; ")
      : signals.length
        ? `Mentions ${signals.join("; ")}, but not enough to read as a certificate request.`
        : "Nothing in the subject or body asks for a certificate of insurance.",
    signals,
  };
}
