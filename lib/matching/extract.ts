/**
 * Pull candidate insured names out of an inbound email.
 *
 * ---------------------------------------------------------------------------
 * THE TRAP THIS FILE EXISTS TO AVOID
 *
 * The company that SENDS a COI request is usually not the company the
 * certificate is FOR. A freight broker emails asking for a certificate on their
 * carrier; the broker is the certificate holder, the carrier is the insured.
 * Their name is all over the message — in the from-address, the signature, the
 * footer — and it is the wrong answer.
 *
 * So this extractor never guesses from the sender. It only returns names that
 * appear in a position which states who the certificate is for: after "COI
 * for", behind an "Insured:" label, and so on. If no such phrasing is present
 * it returns nothing, and the request goes to a human. Silence is a correct
 * answer here.
 *
 * No AI. These are patterns over the text; lib/matching/resolve.ts then decides
 * which client record (if any) a candidate refers to. An LLM can replace this
 * file later without touching anything downstream — the contract is just
 * "text in, candidate names out".
 * ---------------------------------------------------------------------------
 */

export type ExtractionSource =
  | "label" // "Insured: X"
  | "coiFor" // "certificate of insurance for X"
  | "subjectTag" // "COI request — X"
  | "onBehalfOf" // "on behalf of X"
  | "model"; // read by an LLM (lib/llm/insured.ts) rather than a pattern

export interface Extraction {
  name: string;
  source: ExtractionSource;
  /** Prior confidence in the PHRASING, not in the name. 0–1. */
  weight: number;
  /** Where it came from, for the audit trail and for a human reviewing. */
  evidence: string;
}

/** How much to trust each phrasing, most explicit first. */
const WEIGHTS: Record<ExtractionSource, number> = {
  label: 1.0,
  coiFor: 0.9,
  onBehalfOf: 0.75,
  subjectTag: 0.7,
  model: 0.95,
};

/**
 * Words that end a company name.
 *
 * A name runs until the sentence turns back into prose. Without this,
 * "a COI for Smart Way Solutions please send by Friday" captures the whole
 * tail of the sentence.
 */
const STOP_WORDS = new Set([
  "please", "thanks", "thank", "asap", "as", "by", "before", "for", "and",
  "with", "who", "which", "that", "we", "they", "our", "their", "you", "your",
  "is", "are", "was", "has", "have", "will", "would", "should", "can", "could",
  "at", "on", "in", "to", "from", "this", "the", "a", "an", "if", "when",
  "regards", "sincerely", "best", "cheers", "attached", "attn", "re",
]);

/** Suffixes that are part of the name even though a comma precedes them. */
const SUFFIX_TOKENS = new Set([
  "inc", "inc.", "llc", "l.l.c.", "llp", "ltd", "ltd.", "co", "co.", "corp",
  "corp.", "incorporated", "company", "limited", "plc", "pllc", "pc",
]);

const MAX_NAME_WORDS = 8;

/**
 * Trim a raw capture down to something that looks like a company name.
 *
 * Returns "" when nothing name-like survives — the caller drops it.
 */
function cleanName(raw: string): string {
  let text = raw
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Leading articles and stray punctuation.
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/^[^\p{L}\p{N}]+/u, "");

  // Cut at sentence-ending punctuation, but not at a comma that introduces a
  // company suffix ("Smart Way Solutions, LLC").
  text = text.replace(/([.;:!?])\s.*$/u, "$1").replace(/[.;:!?]+$/u, "");

  const words = text.split(" ").filter(Boolean);
  const kept: string[] = [];

  for (const word of words) {
    if (kept.length >= MAX_NAME_WORDS) break;
    const bare = word.replace(/[^\p{L}\p{N}.]/gu, "").toLowerCase();

    // A suffix always belongs, even though it may follow a comma.
    if (SUFFIX_TOKENS.has(bare)) {
      kept.push(word);
      continue;
    }
    // Prose resumed — the name ended at the previous word.
    if (STOP_WORDS.has(bare)) break;
    // A comma that is not introducing a suffix also ends the name.
    if (kept.length && /,$/.test(kept[kept.length - 1])) break;

    kept.push(word);
  }

  const name = kept.join(" ").replace(/[,\s]+$/u, "").trim();

  // One bare word is almost never enough to identify a company, and is the
  // shape most likely to be a false positive ("a COI for Monday").
  if (!name || name.split(" ").length < 2) return "";
  return name;
}

/** Ordered so the most explicit phrasings are tried first. */
const PATTERNS: { source: ExtractionSource; re: RegExp }[] = [
  // "Insured: Smart Way Solutions Inc" / "Named Insured - X"
  { source: "label", re: /(?:named\s+)?insured\s*[:\-–—]\s*(.+)/giu },
  // "certificate of insurance for X", "COI for X", "cert for X"
  {
    source: "coiFor",
    re: /(?:certificates?\s+of\s+insurance|c\.?o\.?i\.?|certificates?)\s*(?:request\s*)?(?:for|on)\s+(.+)/giu,
  },
  // "on behalf of X"
  { source: "onBehalfOf", re: /on\s+behalf\s+of\s+(.+)/giu },
  // Subject line: "COI request — X", "Certificate of Insurance: X"
  {
    source: "subjectTag",
    re: /(?:certificates?\s+of\s+insurance|c\.?o\.?i\.?|insurance\s+certificate)\s*(?:request)?\s*[:\-–—]\s*(.+)/giu,
  },
];

export interface EmailInput {
  subject?: string | null;
  body?: string | null;
}

/**
 * Extract candidate insured names, best phrasing first and de-duplicated.
 *
 * An empty result is a legitimate outcome, not a failure: it means the email
 * never said who the certificate was for in a form we recognise.
 */
/**
 * The body with the signature block cut off.
 *
 * Signature blocks are where the SENDER's company lives, and the sender is the
 * certificate HOLDER, never the insured. Cutting them off removes the single
 * richest source of wrong answers — and it is the mirror image of
 * lib/matching/holder.ts, which reads only what is below this line.
 */
export function bodyAboveSignature(body: string): string {
  return body.split(
    /^\s*(?:--+|thanks[,!.]?|thank you[,!.]?|regards[,!.]?|best regards[,!.]?|sincerely[,!.]?)\s*$/imu
  )[0];
}

/**
 * Everything a reader of a FIRST email may look at, as one string: the subject
 * and the body above the sign-off.
 *
 * Exported because the pattern reader, the LLM reader (lib/llm/insured.ts) and
 * its guards must all judge the same words — a model shown more text than the
 * guard checks against is a hole in the guard.
 */
export function requestText(email: EmailInput): string {
  return [email.subject ?? "", email.body ? bodyAboveSignature(email.body) : ""]
    .filter((part) => part.trim())
    .join("\n\n");
}

export function extractInsuredNames(email: EmailInput): Extraction[] {
  const sections: { text: string; label: string }[] = [];
  if (email.subject) sections.push({ text: email.subject, label: "subject" });
  if (email.body) sections.push({ text: bodyAboveSignature(email.body), label: "body" });

  const found: Extraction[] = [];
  const seen = new Set<string>();

  for (const { source, re } of PATTERNS) {
    for (const { text, label } of sections) {
      // Patterns are /g — reset between uses or matching resumes mid-string.
      re.lastIndex = 0;
      for (const match of text.matchAll(re)) {
        const name = cleanName(match[1] ?? "");
        if (!name) continue;

        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        found.push({
          name,
          source,
          weight: WEIGHTS[source],
          evidence: `${label}: "${match[0].trim().slice(0, 90)}"`,
        });
      }
    }
  }

  return found.sort((a, b) => b.weight - a.weight);
}
