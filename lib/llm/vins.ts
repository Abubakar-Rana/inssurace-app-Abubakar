/**
 * Reading whether a requester asked for the insured's VEHICLES, with a model.
 *
 * ---------------------------------------------------------------------------
 * THE DIRECTION OF THE RISK
 *
 * Saying yes prints the insured's whole fleet — year, make, model, value and
 * VIN of every unit — to a third party (lib/matching/vinRequest.ts). Saying no
 * leaves it out, and the reviewer can add it. So the model may add a YES where
 * the patterns heard silence, and only by QUOTING where the requester asked:
 *
 *   VERBATIM    the quote appears in the requester's own words — the subject and
 *               each message above any quoted reply — case and spacing aside.
 *   VEHICLES    the quote names vehicle detail: a VIN, a unit or serial number,
 *               a vehicle / equipment schedule or list, the trucks listed…
 *   NOT A NO    the quote contains no negation. "We don't need the truck list"
 *               names vehicles too.
 *
 * Anything else is "no". The model is consulted only when the patterns found
 * neither a request nor a decline (lib/matching/vinRead.ts).
 * ---------------------------------------------------------------------------
 */

import { readJson } from "./client";
import { messagesOf } from "./messages";
import type { VinRequestInput } from "@/lib/matching/vinRequest";

/** The text the model is shown and the quote is checked against: the requester's own words. */
export function vinText(email: VinRequestInput): string {
  const body = messagesOf(email.body).filter((m: string) => m.trim()).join("\n\n");
  return [email.subject ?? "", body].filter((s) => s.trim()).join("\n\n").trim();
}

const SYSTEM = [
  "You read an email asking an insurance agency for a certificate of insurance.",
  "",
  "Decide whether the requester ASKED for the insured's vehicles to be listed on the",
  "certificate: VINs, unit or serial numbers, a vehicle or equipment schedule, the",
  "year / make / model of the trucks or trailers.",
  "  wanted     true only if they asked for that",
  "  evidence   when wanted is true: the exact words where they asked, copied verbatim",
  "             from the email — one phrase or sentence. Otherwise null.",
  "  note       one short clause saying what you read, for a log line",
  "",
  "RULES",
  "",
  "1. Listing vehicles discloses the insured's whole fleet to a third party. When in",
  "   doubt, wanted is false.",
  "2. Mentioning a truck, a load or a trailer is not asking for vehicles to be listed.",
  "   'The truck picks up Monday' is false. 'Please show the trucks covered' is true.",
  "3. Declining ('no vehicle list needed', 'without the VINs') is false.",
  "4. Only the requester's own words count — not a quoted or forwarded message.",
  "5. COPY, NEVER WRITE. evidence must be copied character for character from the email.",
].join("\n");

export const VIN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["wanted", "evidence", "note"],
  properties: {
    wanted: { type: "boolean" },
    evidence: { anyOf: [{ type: "string" }, { type: "null" }] },
    note: { type: "string" },
  },
};

export function vinPrompt(text: string): { system: string; user: string; schema: Record<string, unknown> } {
  return { system: SYSTEM, user: ["EMAIL (subject, then the requester's own words):", "---", text, "---"].join("\n"), schema: VIN_SCHEMA };
}

/** Vehicle detail, named. What a quote must contain to count as asking for the schedule. */
const VEHICLE_TERM = new RegExp(
  [
    String.raw`\bv\.?i\.?n`,
    String.raw`\bvehicle\s+identification`,
    String.raw`\b(?:unit|serial)\s*(?:numbers?|nos?\b\.?|#)`,
    String.raw`\b(?:vehicle|auto|equipment|truck|trailer|tractor|fleet|unit)s?\s+(?:schedule|list(?:ing)?)\b`,
    String.raw`\bschedul(?:e|ed)\s+(?:of\s+)?(?:the\s+)?(?:vehicles|autos|units|equipment|trucks|trailers|tractors)\b`,
    String.raw`\blist(?:ing)?\s+(?:of\s+)?(?:the\s+|all\s+|their\s+|each\s+)?(?:vehicles|trucks|tractors|trailers|units|equipment|autos|power\s+units)\b`,
    String.raw`\b(?:show|include|add|put|name)\s+(?:the\s+|all\s+|their\s+|each\s+)?(?:vehicles|trucks|tractors|trailers|power\s+units|autos)\b`,
    String.raw`\b(?:vehicles|trucks|tractors|trailers|units|autos|equipment)\s+(?:listed|scheduled|described|covered|insured)\b`,
    String.raw`\byear\s*(?:,|\/|and)\s*make\b`,
  ].join("|"),
  "i"
);

const NEGATION = /\b(?:no|not|without|omit|exclude|skip|never|none)\b|n['’]t\b/i;

const loose = (value: string) => value.toLowerCase().replace(/[“”"]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

export type VinVerdict = { ok: true; wanted: boolean; evidence: string | null } | { ok: false; reason: string };

/**
 * A model response turned into a yes, a no, or a refusal. PURE — every branch is
 * a case in `npm run verify:llm`. `text` must be the `vinText()` the model was shown.
 */
export function acceptVinOutput(raw: unknown, text: string): VinVerdict {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "not an object" };
  const out = raw as { wanted?: unknown; evidence?: unknown };

  if (out.wanted !== true) return { ok: true, wanted: false, evidence: null };

  const quote = typeof out.evidence === "string" ? out.evidence.trim().replace(/^["'“‘]+|["'”’]+$/g, "").trim() : "";
  if (!quote) return { ok: false, reason: "said yes without quoting the request" };
  if (quote.length > 300) return { ok: false, reason: "quote too long to be where they asked" };
  if (!loose(text).includes(loose(quote))) return { ok: false, reason: "quote is not in the requester's own words" };
  if (!VEHICLE_TERM.test(quote)) return { ok: false, reason: "quote names no vehicle detail" };
  if (NEGATION.test(quote)) return { ok: false, reason: "quote reads as a decline" };

  return { ok: true, wanted: true, evidence: quote.replace(/\s+/g, " ") };
}

export type VinLlmReading = { reached: true; verdict: VinVerdict } | { reached: false };

/** Never throws. `text` is `vinText()`. */
export async function readVinsWithLlm(text: string): Promise<VinLlmReading> {
  if (!text.trim()) return { reached: false };
  const { system, user, schema } = vinPrompt(text);
  const result = await readJson({ system, user, schema, label: "vin", maxTokens: 200 });
  if (!result) return { reached: false };
  return { reached: true, verdict: acceptVinOutput(result.output, text) };
}
