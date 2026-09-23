/**
 * Ask the requester which company they meant, and read their answer.
 *
 * ---------------------------------------------------------------------------
 * WHY ASK THE REQUESTER RATHER THAN A COLLEAGUE
 *
 * When two clients are named almost identically — "Smart Way Solutions Inc" and
 * "Smart Way Solutions LLC" — the resolver refuses, correctly. Until now that
 * refusal went to a reviewer, who has to guess just as much as the machine did:
 * the agency's records do not say which of its own clients a stranger meant.
 *
 * The requester does know. They are onboarding one specific carrier, they have
 * that carrier's paperwork in front of them, and they can answer in seconds.
 * Asking them turns an unanswerable question into an answerable one.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE ONLY PLACE THE SYSTEM SENDS MAIL WITHOUT A HUMAN
 *
 * Certificates are never sent automatically, and that has not changed. What is
 * sent here is a QUESTION. It contains no coverage, no limits, no policy
 * numbers and no document — nothing that anybody could rely on or that could be
 * wrong in a way that matters.
 *
 * It does disclose one thing, so it is worth being deliberate about: that this
 * agency has clients whose names resemble what the requester wrote. The message
 * therefore names only the candidates already implied by the requester's own
 * words, never the wider client list, and asks for an identifier rather than
 * offering to confirm one.
 *
 * GMAIL_CLARIFY=0 turns it off entirely, and those requests go to a reviewer
 * exactly as they did before.
 * ---------------------------------------------------------------------------
 */

import { readIdentifiers, type Identifiers } from "./identifier";
import type { Candidate } from "./resolve";

/** Off switch, so an agency that would rather not write to requesters can say so. */
export function clarificationEnabled(): boolean {
  return process.env.GMAIL_CLARIFY !== "0";
}

/**
 * The question, as plain text.
 *
 * Plain text on purpose: it has to read correctly in every mail client, it is
 * going to be quoted in a reply, and there is nothing here that formatting
 * would clarify.
 *
 * The candidates are listed WITHOUT their addresses or client numbers. Naming
 * them is unavoidable — that is the question — but the agency's record of where
 * they are and what they are worth is not the requester's business.
 */
export function composeClarification(
  askedFor: string,
  candidates: Candidate[],
  producerName: string
): string {
  const names = candidates.slice(0, 4).map((c) => `  - ${c.legalName}`);

  return [
    `Thanks for your request.`,
    ``,
    `Before we can issue the certificate we need to confirm which company you`,
    `mean. "${askedFor}" matches more than one of our insureds:`,
    ``,
    ...names,
    ``,
    `Rather than have us guess, please reply with ANY ONE of the following:`,
    ``,
    `  - the carrier's USDOT number   (for example: USDOT 1234567)`,
    `  - the carrier's MC number      (for example: MC 123456)`,
    `  - the company's full legal name, exactly as it appears above`,
    ``,
    `A USDOT or MC number is the most reliable, since each one belongs to a`,
    `single carrier. We will issue the certificate as soon as we hear back.`,
    ``,
    `This message was sent automatically because the request was ambiguous. No`,
    `certificate has been issued.`,
    ``,
    producerName,
  ].join("\n");
}

export type ClarificationAnswer =
  | { kind: "identifier"; identifiers: Identifiers }
  | { kind: "name"; candidate: Candidate }
  | { kind: "none"; reason: string };

/**
 * Read a reply and work out what the requester chose.
 *
 * Order matters. An identifier is checked first and wins outright, because it
 * is exact where a name is not — and a reply commonly contains both ("that's
 * Smart Way Solutions, MC 1084463"), in which case the number is the better
 * evidence.
 */
export function readClarification(text: string, candidates: Candidate[]): ClarificationAnswer {
  const body = stripQuotedReply(text ?? "");

  const identifiers = readIdentifiers(body);
  if (identifiers.dot || identifiers.mc) {
    return { kind: "identifier", identifiers };
  }

  // A name only counts when it distinguishes. If the reply names something that
  // matches two candidates equally — which is exactly what the question was
  // about — nothing has been settled and it is not an answer.
  const normalised = normalise(body);
  const named = candidates.filter((c) => normalised.includes(normalise(c.legalName)));

  if (named.length === 1) return { kind: "name", candidate: named[0] };
  if (named.length > 1) {
    return { kind: "none", reason: "The reply names more than one of the candidates." };
  }

  return {
    kind: "none",
    reason: "The reply does not contain a USDOT number, an MC number, or a full legal name.",
  };
}

/**
 * Drop the quoted original.
 *
 * A reply usually carries our own question underneath it, and our question
 * lists every candidate by name. Reading that back would match all of them and
 * make every reply look ambiguous — or worse, pick up the example numbers from
 * the message we sent.
 */
export function stripOurExamples(text: string): string {
  return stripQuotedReply(text ?? "")
    // The example numbers from our own message, should any survive the cut.
    .replace(/\(for example:[^)]*\)/gi, " ")
    .replace(/^\s*-\s*the (?:carrier's|company's)[^\n]*$/gim, " ");
}

function stripQuotedReply(text: string): string {
  const cut = text.search(
    /^\s*(?:>|on .+ wrote:|-{3,}\s*original message|_{5,}|from:\s)/im
  );
  return cut > 0 ? text.slice(0, cut) : text;
}

/** Compare names ignoring case, punctuation and spacing. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
