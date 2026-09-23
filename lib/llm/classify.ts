/**
 * Reading whether a NEAR-MISS email asks for a certificate, with a model.
 *
 * ---------------------------------------------------------------------------
 * ONLY NEAR-MISSES, ONLY A QUOTED YES
 *
 * The mailbox filter (lib/gmail/classify.ts) passes over most of a shared
 * inbox, and none of that mail is ever stored. A model reading all of it would
 * send the agency's unrelated correspondence to an API — so it reads only mail
 * where some request signal fired below the threshold (`isNearMiss`), and mail
 * with no signal at all never leaves the machine.
 *
 * A YES stores the email and puts it in front of a reviewer; a no leaves it on
 * the dashboard's passed-over list, where a person can still see it. The model
 * may only add a yes, and only by QUOTING the ask:
 *
 *   VERBATIM    in the subject or the body above the signature, case and
 *               spacing aside
 *   DOCUMENT    names what is asked for: a certificate, COI, ACORD, proof or
 *               evidence of insurance/coverage, additional insured…
 *   ASKING      reads as asking: a question, please, need, send, can you…
 *               ("COI attached" names the document and asks for nothing)
 *   NOT A NO    no negation: "we no longer need the COI" names it too
 * ---------------------------------------------------------------------------
 */

import { readJson } from "./client";
import { requestText } from "@/lib/matching/extract";
import type { ClassifyInput } from "@/lib/gmail/classify";

/** What the model is shown and the quote is checked against. */
export function classifyText(email: ClassifyInput): string {
  return requestText({ subject: email.subject, body: email.body });
}

const SYSTEM = [
  "You read one email that arrived in an insurance agency's shared mailbox.",
  "",
  "Decide whether the sender is ASKING the agency for a certificate of insurance or other",
  "proof that one of its clients is insured: a COI, an ACORD 25, evidence or proof of",
  "coverage, a certificate naming them as holder or additional insured, an updated certificate.",
  "  isRequest  true only if they are asking for that",
  "  evidence   when true: the exact words where they ask, copied verbatim — one phrase or",
  "             sentence. Otherwise null.",
  "  note       one short clause saying what you read, for a log line",
  "",
  "RULES",
  "",
  "1. Insurance vocabulary is not a request. Renewal notices, policy documents, invoices,",
  "   quotes, claims, loss runs, marketing and newsletters are false.",
  "2. Sending a certificate, or talking about one without asking for it, is false.",
  "3. Declining or cancelling ('we no longer need the COI') is false.",
  "4. COPY, NEVER WRITE. evidence must be copied character for character from the email.",
  "5. A false yes stores someone's unrelated email for thirty days. When in doubt, false.",
].join("\n");

export const CLASSIFY_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["isRequest", "evidence", "note"],
  properties: {
    isRequest: { type: "boolean" },
    evidence: { anyOf: [{ type: "string" }, { type: "null" }] },
    note: { type: "string" },
  },
};

export function classifyPrompt(text: string): { system: string; user: string; schema: Record<string, unknown> } {
  return {
    system: SYSTEM,
    user: ["EMAIL (subject, then body; the signature has been removed):", "---", text, "---"].join("\n"),
    schema: CLASSIFY_SCHEMA,
  };
}

const DOCUMENT_TERM =
  /certif|\bc\.?o\.?i\.?s?\b|\bacord\b|(?:proof|evidence)\s+of\s+(?:insurance|coverage)|additional(?:ly)?\s+insured|insurance\s+(?:docs?|documents?|paperwork|papers)|\bcoverage\b|\binsurance\b/i;

const ASKING =
  /\?|\b(?:please|pls|plz|kindly|need|needs|needed|require[ds]?|requesting|request|send|provide|issue|forward|email|get|obtain|can\s+(?:you|we|i)|could\s+(?:you|we|i)|would\s+you|may\s+(?:we|i)|looking\s+for|asap|update)\b/i;

const NEGATION = /\b(?:no|not|without|never|none|cancel(?:led|ed)?)\b|n['’]t\b|\bno\s+longer\b/i;

const loose = (value: string) =>
  value.toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

export type ClassifyVerdict = { ok: true; isRequest: boolean; evidence: string | null } | { ok: false; reason: string };

/** PURE — every branch is a case in `npm run verify:llm`. `text` must be the `classifyText()` shown. */
export function acceptClassifyOutput(raw: unknown, text: string): ClassifyVerdict {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "not an object" };
  const out = raw as { isRequest?: unknown; evidence?: unknown };

  if (out.isRequest !== true) return { ok: true, isRequest: false, evidence: null };

  const quote = typeof out.evidence === "string" ? out.evidence.trim().replace(/^["'“‘]+|["'”’]+$/g, "").trim() : "";
  if (!quote) return { ok: false, reason: "said yes without quoting the request" };
  if (quote.length > 300) return { ok: false, reason: "quote too long to be where they asked" };
  if (!loose(text).includes(loose(quote))) return { ok: false, reason: "quote is not in the email" };
  if (!DOCUMENT_TERM.test(quote)) return { ok: false, reason: "quote names no certificate or proof of insurance" };
  if (!ASKING.test(quote)) return { ok: false, reason: "quote does not ask for anything" };
  if (NEGATION.test(quote)) return { ok: false, reason: "quote reads as a decline" };

  return { ok: true, isRequest: true, evidence: quote.replace(/\s+/g, " ") };
}

export type ClassifyLlmReading = { reached: true; verdict: ClassifyVerdict } | { reached: false };

/** Never throws. `text` is `classifyText()`. */
export async function readClassifyWithLlm(text: string): Promise<ClassifyLlmReading> {
  if (!text.trim()) return { reached: false };
  const { system, user, schema } = classifyPrompt(text);
  const result = await readJson({ system, user, schema, label: "classify", maxTokens: 200 });
  if (!result) return { reached: false };
  return { reached: true, verdict: acceptClassifyOutput(result.output, text) };
}
