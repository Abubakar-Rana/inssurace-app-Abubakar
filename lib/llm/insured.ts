/**
 * Reading WHICH INSURED a first email is about, with a language model.
 *
 * ---------------------------------------------------------------------------
 * THE MODEL READS. IT DOES NOT DECIDE.
 *
 * What comes back from here is a few company names and up to two numbers,
 * copied out of the email. The names go to `resolve.ts`, which still abstains
 * on a near-tie; the numbers go to `resolveByIdentifier`, which matches exactly
 * or not at all. The model cannot pick a client, and it cannot put a limit, a
 * policy number or a date anywhere — interpretation has nowhere to put one.
 *
 * It is consulted only where the patterns read NOTHING that resolves: no
 * phrasing extract.ts knows, no labelled USDOT/MC number (lib/matching/
 * interpret.ts → `readInsured`). A confident pattern answer is never asked about.
 *
 * ---------------------------------------------------------------------------
 * THE GUARDS, ALL DETERMINISTIC
 *
 *   TEXT        The model is shown `insuredText()` — the subject and the body
 *               above the signature, our own example numbers removed — and
 *               every value is checked against exactly that text. What it never
 *               sees it cannot copy: the sender's letterhead, including the
 *               broker's own MC number, is not in it.
 *   VERBATIM    A name must appear as whole words (case and spacing aside), not
 *               inside an email address or URL; a number must appear as a whole
 *               run of digits. A value that is NOT in the text means the model
 *               wrote rather than read, and the WHOLE answer is refused.
 *   SHAPE       A name is 2-8 words (one bare word is how "a COI for Monday"
 *               happens); at most three names. A number is a plausible length,
 *               stands alone rather than inside a phone number or ZIP+4, and is
 *               not introduced by a word naming another kind of number
 *               (policy, phone, load…). These drop the value, not the answer.
 *   REGISTER    A number whose kind the email does not state goes into BOTH the
 *               DOT and MC columns, exactly as the clarify reader does: the
 *               database says what it means.
 * ---------------------------------------------------------------------------
 */

import { readJson } from "./client";
import { COMPETING, type Identifiers } from "@/lib/matching/identifier";
import { requestText, type EmailInput, type Extraction } from "@/lib/matching/extract";
import { stripOurExamples } from "@/lib/matching/clarify";

const DOT_LEN = [5, 9] as const;
const MC_LEN = [4, 9] as const;
const MAX_NAMES = 3;
const NAME_WORDS = [2, 8] as const;

/**
 * The text a first-email reader may look at. The model is shown this, the
 * guards check against this, and the USDOT/MC pattern in interpret.ts reads
 * this — so all three are looking at the same words.
 */
export function insuredText(email: EmailInput): string {
  return stripOurExamples(requestText(email)).trim();
}

const SYSTEM = [
  "You read an email sent to an insurance agency asking for a certificate of insurance (COI).",
  "",
  "Report which company the certificate is FOR — the insured, normally a trucking company",
  "or motor carrier the agency insures — and any federal number the email gives for it:",
  "  companies   the insured's name, copied exactly as written; usually one; [] if not stated",
  "  usdot       the insured's USDOT number, digits only, or null",
  "  mc          the insured's MC / MX / FF / motor carrier / docket number, or null",
  "  unlabelled  a number plainly offered as the insured's identifier without saying",
  "              which kind, or null",
  "  note        one short clause saying what you read, for a log line",
  "",
  "RULES",
  "",
  "1. The insured is NOT: the person or company sending the email (a broker, shipper,",
  "   factoring company or compliance service asking on its own behalf); the certificate",
  "   holder or additional insured (whoever the certificate is to be made out or sent to);",
  "   the insurance agency; an insurance company. If you cannot tell whether a company is",
  "   the insured or one of these, leave it out.",
  "",
  "2. COPY, NEVER WRITE. A name must be copied from the email as it is written, with the",
  "   Inc / LLC only if the email has one. Never correct spelling, complete a name, expand",
  "   an abbreviation or add a suffix. A name not written in the email must not be returned.",
  "",
  "3. At most three names, and more than one only when the email itself names the insured",
  "   in more than one way.",
  "",
  "4. Copy digits exactly as written. Never correct, complete or reformat a number. A",
  "   transposed digit in a DOT number names a completely unrelated carrier, so a number",
  "   you are unsure of must be null.",
  "",
  "5. A policy number, invoice number, reference, phone number, zip code, VIN, account or",
  "   load number is NOT a USDOT or MC number and belongs in none of these fields. Neither",
  "   is a number belonging to the sender's or the holder's company.",
  "",
  "6. If the email gives the insured's number without saying WHICH KIND it is, put it in",
  "   unlabelled and leave usdot and mc null. Do not guess the register.",
  "",
  "7. USDOT numbers are 5-9 digits. MC numbers are 4-9 digits.",
  "",
  "8. An empty list and nulls is a correct and common answer. It means the email did not",
  "   say, and the agency will ask. Guessing is worse than saying nothing.",
].join("\n");

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };

export const INSURED_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["companies", "usdot", "mc", "unlabelled", "note"],
  properties: {
    companies: { type: "array", items: { type: "string" } },
    usdot: nullableString,
    mc: nullableString,
    unlabelled: nullableString,
    note: { type: "string" },
  },
};

export function insuredPrompt(text: string): { system: string; user: string; schema: Record<string, unknown> } {
  const user = ["EMAIL (subject, then body; the signature has been removed):", "---", text ?? "", "---"].join("\n");
  return { system: SYSTEM, user, schema: INSURED_SCHEMA };
}

// ---------------------------------------------------------------- guards

export type InsuredVerdict =
  | {
      ok: true;
      /** Names to resolve, in the requester's own spelling. */
      names: Extraction[];
      identifiers: Identifiers;
      /** Values dropped by a SHAPE guard, for the log line. */
      dropped: string[];
    }
  | { ok: false; reason: string };

const EMAIL_ANY = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const URL_ANY = /\b(?:https?:\/\/|www\.)\S+/gi;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The first whole-word occurrence of `name`, as written, or null. Addresses and URLs cannot supply one. */
function findName(text: string, name: string): string | null {
  const body = escapeRegExp(name.trim()).replace(/\s+/g, "\\s+");
  if (!body) return null;
  const masked = text
    .replace(EMAIL_ANY, (m) => " ".repeat(m.length))
    .replace(URL_ANY, (m) => " ".repeat(m.length))
    // A possessive still names the company: "Smart Way Solutions Inc's certificate".
    // Blanked (same length) so the whole-word check does not see "'s" as more name.
    .replace(/(?<=[A-Za-z0-9.])['’]s\b/g, "  ");
  const re = new RegExp(`(?<![A-Za-z0-9]|[A-Za-z0-9][-'’.@])${body}(?![A-Za-z0-9]|[-'’.][A-Za-z0-9])`, "i");
  const m = masked.match(re);
  if (!m || m.index === undefined) return null;
  return text.slice(m.index, m.index + m[0].length).replace(/\s+/g, " ");
}

/** A label for a DOT or MC number — its presence between a competing word and the digits cancels the competition. */
const OUR_LABEL = /\b(?:u\.?\s?s\.?\s*)?d\.?\s?o\.?\s?t\b|\bm\.?\s?[cx]\b|\bf\.?\s?f\b|motor\s+carrier|docket/i;

type NumberCheck = { value: string } | { invented: true } | { dropped: string };

function checkNumber(raw: unknown, bounds: readonly [number, number], text: string, field: string): NumberCheck | null {
  if (typeof raw !== "string") return null;
  const value = raw.replace(/\D/g, "");
  if (!value) return null;

  // VERBATIM: a whole run of digits, not spliced from a longer one.
  const runs: string[] = text.match(/\d+/g) ?? [];
  if (!runs.includes(value)) return { invented: true };

  if (value.length < bounds[0] || value.length > bounds[1]) return { dropped: `${field} ${value}: implausible length` };

  // Standing alone, not one group of a phone number, ZIP+4 or date.
  if (!new RegExp(`(?<!\\d[-./ ]?)${value}(?![-./ ]?\\d)`).test(text)) {
    return { dropped: `${field} ${value}: part of a longer number` };
  }

  // Introduced by a word naming another kind of number, with no DOT/MC label between.
  const competing = new RegExp(`\\b(?:${COMPETING})\\b([^\\d\\n]{0,25}?)(?<!\\d)${value}(?!\\d)`, "gi");
  for (const m of text.matchAll(competing)) {
    if (!OUR_LABEL.test(m[1] ?? "")) return { dropped: `${field} ${value}: labelled as another kind of number` };
  }

  return { value };
}

/**
 * Turn a model response into names and numbers to look up, or refuse it.
 *
 * PURE, and exported so every guard is a case in `npm run verify:llm` without a
 * key or a network. `text` must be the `insuredText()` the model was shown.
 */
export function acceptInsuredOutput(raw: unknown, text: string): InsuredVerdict {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "not an object" };
  const out = raw as { companies?: unknown; usdot?: unknown; mc?: unknown; unlabelled?: unknown };
  const dropped: string[] = [];

  // ---- names
  const listed = Array.isArray(out.companies)
    ? out.companies.filter((c): c is string => typeof c === "string" && c.trim() !== "")
    : [];
  if (listed.length > MAX_NAMES) return { ok: false, reason: `named ${listed.length} companies for one request` };

  const names: Extraction[] = [];
  const seen = new Set<string>();
  for (const candidate of listed) {
    const asWritten = findName(text, candidate);
    if (!asWritten) return { ok: false, reason: `company "${candidate}" is not in the email as written` };

    const words = asWritten.split(" ").length;
    if (words < NAME_WORDS[0] || words > NAME_WORDS[1]) {
      dropped.push(`company "${asWritten}": ${words} word${words === 1 ? "" : "s"}`);
      continue;
    }
    const key = asWritten.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push({ name: asWritten, source: "model", weight: 0.6, evidence: `model: "${asWritten}"` });
  }

  // ---- numbers
  const ids: Identifiers = {};
  const take = (check: NumberCheck | null): string | undefined | "invented" => {
    if (!check) return undefined;
    if ("invented" in check) return "invented";
    if ("dropped" in check) {
      dropped.push(check.dropped);
      return undefined;
    }
    return check.value;
  };

  const dot = take(checkNumber(out.usdot, DOT_LEN, text, "usdot"));
  const mc = take(checkNumber(out.mc, MC_LEN, text, "mc"));
  if (dot === "invented" || mc === "invented") return { ok: false, reason: "a number is not in the email as written" };
  if (dot) ids.dot = dot;
  if (mc) ids.mc = mc;

  if (!ids.dot && !ids.mc) {
    const unlabelled = take(checkNumber(out.unlabelled, [MC_LEN[0], DOT_LEN[1]], text, "unlabelled"));
    if (unlabelled === "invented") return { ok: false, reason: "a number is not in the email as written" };
    if (unlabelled) {
      if (unlabelled.length >= DOT_LEN[0]) ids.dot = unlabelled;
      if (unlabelled.length <= MC_LEN[1]) ids.mc = unlabelled;
    }
  }

  return { ok: true, names, identifiers: ids, dropped };
}

export type InsuredLlmReading = { reached: true; verdict: InsuredVerdict } | { reached: false };

/** Read a first email with the model. Never throws. `text` is `insuredText()`. */
export async function readInsuredWithLlm(text: string): Promise<InsuredLlmReading> {
  if (!text.trim()) return { reached: false };
  const { system, user, schema } = insuredPrompt(text);
  const result = await readJson({ system, user, schema, label: "extract", maxTokens: 300 });
  if (!result) return { reached: false };
  return { reached: true, verdict: acceptInsuredOutput(result.output, text) };
}
