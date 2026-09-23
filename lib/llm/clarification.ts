/**
 * Reading a requester's reply with a language model.
 *
 * ---------------------------------------------------------------------------
 * THE MODEL READS. IT DOES NOT DECIDE.
 *
 * What comes back from here is a company name and up to two numbers — nothing
 * else. The name has to be one of the candidates the resolver already produced,
 * and the numbers go to `resolveByIdentifier`, which matches exactly or not at
 * all. Every limit, policy number and date on the certificate still comes from
 * Postgres. The worst a bad read can do is show a reviewer the wrong company;
 * it cannot put false coverage on a document, and the guards below are what
 * keeps that true.
 *
 * ---------------------------------------------------------------------------
 * WHY A MODEL AT ALL, WHEN THE REGEX HAS 59 CASES BEHIND IT
 *
 * The regex is exact and it passes everything anyone has thought to write down.
 * What defeats it is text nobody wrote down: an HTML-only reply flattened by
 * the body extractor, a client that puts the quoted original above the answer,
 * a phrasing that reads perfectly to a person and matches nothing. See
 * HANDOVER.md — the failing reply is a plain sentence with an MC number in it.
 *
 * That is a reading problem, and reading is the one thing a model is reliably
 * better at than a pattern.
 *
 * ---------------------------------------------------------------------------
 * FOUR GUARDS, ALL DETERMINISTIC
 *
 *   1. A number must appear VERBATIM in the reply, as a whole run of digits.
 *      A model cannot invent, complete or correct one — which is precisely the
 *      failure mode `identifier.ts` exists to refuse.
 *   2. A number must be a plausible length for what it claims to be.
 *   3. Our own example numbers are refused. The question we sent contains
 *      "for example: MC 123456", it comes back quoted under every reply, and a
 *      model reading it back would settle the question with our own words.
 *   4. A company name must equal one of the candidates. Not resemble — equal,
 *      after the same normalisation the heuristic uses.
 *
 * Anything that fails a guard is dropped, and dropping everything means the
 * heuristic answers instead.
 * ---------------------------------------------------------------------------
 */

import { readJson } from "./client";
import type { Candidate } from "@/lib/matching/resolve";
import type { ClarificationAnswer } from "@/lib/matching/clarify";

/** USDOT numbers are 5-9 digits; MC numbers are shorter. Same bounds as the regex. */
const DOT_LEN = [5, 9] as const;
const MC_LEN = [4, 9] as const;

const SYSTEM = [
  "You read replies to an automated question sent by an insurance agency.",
  "",
  "The agency received a request for a certificate of insurance naming a company,",
  "found more than one client with a similar name, and emailed the requester to ask",
  "which one they meant. You are reading that reply.",
  "",
  "Report only what the requester wrote:",
  "  usdot       the carrier's USDOT number, digits only, or null",
  "  mc          the carrier's MC / MX / FF / motor carrier / docket number, or null",
  "  unlabelled  a number they plainly offered as the carrier's identifier but",
  "              did not say which kind, or null",
  "  company     the candidate they named, copied exactly from the list, or null",
  "  note        one short clause saying what you read, for a log line",
  "",
  "RULES",
  "",
  "1. Read ONLY what the requester wrote in this reply. Ignore every quoted or",
  "   forwarded message: lines beginning with '>', anything after 'On ... wrote:',",
  "   '-----Original Message-----', or a 'From:' header block. The agency's own",
  "   question is normally quoted underneath the reply. It lists every candidate",
  "   and it contains EXAMPLE numbers. None of that is the requester's answer.",
  "",
  "2. Copy digits exactly as written. Never correct, complete, reformat or infer a",
  "   number. A transposed digit in a DOT number names a completely unrelated",
  "   carrier, so a number you are unsure of must be null.",
  "",
  "3. A policy number, invoice number, reference, phone number, zip code, VIN,",
  "   account or load number is NOT a USDOT or MC number, however close it sits to",
  "   one, and belongs in none of these fields.",
  "",
  "4. If the requester answers with a number but does not say WHICH KIND it is —",
  "   'sure, 1234567, that's the one' — put it in unlabelled and leave usdot and",
  "   mc null. DO NOT GUESS which register it belongs to. The agency looks the",
  "   number up in both, and exactly one carrier comes back or none does; a guess",
  "   here only removes that. Rule 3 still applies: a number they told you was",
  "   something else is not an answer.",
  "",
  "5. USDOT numbers are 5-9 digits. MC numbers are 4-9 digits.",
  "",
  "6. company must be one of the candidate names given, character for character,",
  "   and only when the requester clearly meant that one. If they named two, or",
  "   named something that is not on the list, it is null.",
  "",
  "7. Returning null for all of them is a correct and common answer. It means the",
  "   reply did not say. A person will read it instead. Guessing is worse than",
  "   saying nothing.",
].join("\n");

/** Built once per call: the candidate names are a closed set the model must pick from. */
function schemaFor(candidates: Candidate[]): Record<string, unknown> {
  const names = candidates.map((c) => c.legalName);

  return {
    type: "object",
    additionalProperties: false,
    required: ["usdot", "mc", "unlabelled", "company", "note"],
    properties: {
      usdot: { anyOf: [{ type: "string" }, { type: "null" }] },
      mc: { anyOf: [{ type: "string" }, { type: "null" }] },
      unlabelled: { anyOf: [{ type: "string" }, { type: "null" }] },
      // An enum, so the model cannot name a company that is not on the list.
      // Guard 4 re-checks it anyway; this just makes the common case cheap.
      company: { anyOf: [{ enum: names }, { type: "null" }] },
      note: { type: "string" },
    },
  };
}

export function clarificationPrompt(
  text: string,
  candidates: Candidate[]
): { system: string; user: string; schema: Record<string, unknown> } {
  const user = [
    "CANDIDATES (the requester meant exactly one of these):",
    ...candidates.map((c) => `  ${c.legalName}`),
    "",
    "REPLY:",
    "---",
    text ?? "",
    "---",
  ].join("\n");

  return { system: SYSTEM, user, schema: schemaFor(candidates) };
}

/** Every whole run of digits in the text. A number must be one of these. */
function digitRuns(text: string): Set<string> {
  return new Set(text.match(/\d+/g) ?? []);
}

/**
 * Guard 3: our own examples.
 *
 * `composeClarification` writes "(for example: USDOT 1234567)" and
 * "(for example: MC 123456)". Those strings arrive back quoted under the reply.
 * This refuses a number only when it is OUR example sitting in OUR sentence —
 * narrow on purpose, so a requester whose real MC number happens to look like
 * an example is not refused for it.
 */
function isOurOwnExample(value: string, text: string): boolean {
  return new RegExp(String.raw`for example:\s*(?:USDOT|US\s*DOT|DOT|MC)\s*${value}\b`, "i").test(text);
}

function readNumber(
  raw: unknown,
  bounds: readonly [number, number],
  runs: Set<string>,
  text: string
): string | undefined {
  if (typeof raw !== "string") return undefined;

  const value = raw.replace(/\D/g, "");
  if (!value) return undefined;

  // Guard 2: a plausible length for what it claims to be.
  if (value.length < bounds[0] || value.length > bounds[1]) return undefined;

  // Guard 1: verbatim, as a whole run. Not spliced out of a longer number and
  // not invented.
  if (!runs.has(value)) return undefined;

  // Guard 3.
  if (isOurOwnExample(value, text)) return undefined;

  return value;
}

/** Compare names ignoring case, punctuation and spacing — as clarify.ts does. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Turn a model response into an answer, or into nothing.
 *
 * PURE, and exported so the guards can be tested without spending money or
 * touching the network. Every rejection path here is a case in
 * `npm run verify:llm`.
 */
export function interpretModelOutput(
  raw: unknown,
  text: string,
  candidates: Candidate[]
): ClarificationAnswer | null {
  if (!raw || typeof raw !== "object") return null;

  const out = raw as {
    usdot?: unknown;
    mc?: unknown;
    unlabelled?: unknown;
    company?: unknown;
    note?: unknown;
  };
  const runs = digitRuns(text ?? "");
  const body = text ?? "";

  let dot = readNumber(out.usdot, DOT_LEN, runs, body);
  let mc = readNumber(out.mc, MC_LEN, runs, body);

  /**
   * A number the requester offered without saying which register it is in.
   *
   * "Sure — 1043790, that's the one." A person reads that as the answer, and so
   * should we; what nobody can do from the text alone is say whether it is a
   * DOT number or an MC number. The model was picking one, getting it wrong
   * half the time, and turning a resolvable reply into a dead end.
   *
   * So it does not pick. The number goes into BOTH columns and
   * `resolveByIdentifier` settles it: the lookup ORs the two, and either
   * exactly one carrier comes back or none does. Two carriers — the agency's
   * own records giving one company's DOT number to another as its MC number —
   * returns nothing and goes to a human, which is right.
   *
   * This is the whole design in miniature. The model reads a number off a page.
   * The database says what the number means.
   */
  if (!dot && !mc) {
    const unlabelled = readNumber(out.unlabelled, [Math.min(DOT_LEN[0], MC_LEN[0]), Math.max(DOT_LEN[1], MC_LEN[1])], runs, body);
    if (unlabelled) {
      if (unlabelled.length >= DOT_LEN[0] && unlabelled.length <= DOT_LEN[1]) dot = unlabelled;
      if (unlabelled.length >= MC_LEN[0] && unlabelled.length <= MC_LEN[1]) mc = unlabelled;
    }
  }

  // An identifier wins outright, for the same reason it does in the heuristic:
  // it is exact where a name is not, and a reply commonly contains both.
  if (dot || mc) {
    return { kind: "identifier", identifiers: { ...(dot ? { dot } : {}), ...(mc ? { mc } : {}) } };
  }

  // Guard 4: the name must BE a candidate, not resemble one.
  if (typeof out.company === "string" && out.company.trim()) {
    const wanted = normalise(out.company);
    const hits = candidates.filter((c) => normalise(c.legalName) === wanted);
    if (hits.length === 1) return { kind: "name", candidate: hits[0] };
    return null;
  }

  return null;
}

/**
 * What came back, and whether the model was reached at all.
 *
 * The distinction matters for the log. "The model read nothing" is a reading a
 * reviewer might want to compare against; "the model could not be called" is an
 * outage, and printing it as though it were a judgement buries the real ones.
 */
export type LlmReading =
  | { reached: true; answer: ClarificationAnswer | null }
  | { reached: false };

/** Read a reply with the model. Never throws. */
export async function readClarificationWithLlm(
  text: string,
  candidates: Candidate[]
): Promise<LlmReading> {
  if (!candidates.length) return { reached: false };

  const { system, user, schema } = clarificationPrompt(text, candidates);

  const result = await readJson({ system, user, schema, label: "clarify", maxTokens: 256 });
  if (!result) return { reached: false };

  return { reached: true, answer: interpretModelOutput(result.output, text ?? "", candidates) };
}
