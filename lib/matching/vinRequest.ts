/**
 * Did the requester actually ask for vehicle identification numbers?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS OFF BY DEFAULT
 *
 * A VIN identifies a specific vehicle, and a fleet schedule with VINs is a
 * complete inventory of an insured's rolling stock. Most certificate requests
 * do not need one — a broker verifying that a carrier is covered needs the
 * limits and the dates, not the serial number of every tractor. Printing them
 * anyway discloses more of the insured's business than the request asked for,
 * to a third party the insured did not choose.
 *
 * So VINs are omitted unless the email asks. That inverts the usual default:
 * the absence of a request is treated as "do not include", not "no preference".
 *
 * The reviewer can still add them by hand before issuing. This module decides
 * what the DRAFT contains, not what is permitted.
 *
 * Reads the whole email including the signature, unlike extract.ts — "please
 * include VINs" can legitimately appear anywhere, and a false positive here
 * only prints data the insured's own agency already holds, in a field the
 * reviewer is looking at.
 * ---------------------------------------------------------------------------
 */

export interface VinRequestInput {
  subject?: string | null;
  body?: string | null;
}

export interface VinRequest {
  /** True when the email asked for vehicle identification numbers. */
  wanted: boolean;
  /** The phrase that decided it, for the audit entry and the reviewer. */
  evidence: string;
}

/**
 * Phrasings that count as asking.
 *
 * "VIN" is required as a whole word so it cannot fire on "vintage" or a name.
 * The longer spellings are included because plenty of requesters write the
 * term out rather than abbreviating it.
 */
const ASKS: { id: string; re: RegExp }[] = [
  { id: "vehicle identification number", re: /vehicle\s+identification\s+numbers?/i },
  { id: "VIN", re: /\bv\.?i\.?n\.?(?:s|'s|\(s\))?\b/i },
  { id: "unit numbers", re: /\bunit\s+(?:numbers?|#s?)\b/i },
  { id: "serial numbers", re: /\bserial\s+numbers?\b/i },
];

/**
 * Phrasings that ask for the OPPOSITE, and must win.
 *
 * "no VINs needed" contains "VIN" and would otherwise be read as a request for
 * them — the exact inversion this file exists to prevent. Checked first.
 */
const DECLINES: RegExp[] = [
  /\b(?:no|without|omit|exclude|don'?t\s+(?:need|include|want)|do\s+not\s+(?:need|include|want)|not\s+necessary\s+to\s+(?:include|list))\b[^.!?\n]{0,40}?\b(?:v\.?i\.?n\.?s?|vehicle\s+identification|serial\s+numbers?)\b/i,
  /\b(?:v\.?i\.?n\.?s?|vehicle\s+identification\s+numbers?)\b[^.!?\n]{0,30}?\b(?:not\s+(?:required|needed|necessary)|aren'?t\s+needed|are\s+not\s+needed)\b/i,
];

/**
 * Decide whether the draft should carry VINs.
 *
 * Pure: no database, no network, no clock.
 */
export function wantsVins(email: VinRequestInput): VinRequest {
  const text = [email.subject ?? "", email.body ?? ""].join("\n");

  for (const re of DECLINES) {
    const m = text.match(re);
    if (m) {
      return { wanted: false, evidence: `explicitly declined: "${m[0].trim().slice(0, 70)}"` };
    }
  }

  for (const ask of ASKS) {
    const m = text.match(ask.re);
    if (m) {
      return { wanted: true, evidence: `asked for ${ask.id}: "${context(text, m)}"` };
    }
  }

  return { wanted: false, evidence: "the request did not ask for vehicle identification numbers" };
}

/** A little surrounding text, so the reviewer can see the phrasing in context. */
function context(text: string, match: RegExpMatchArray): string {
  const at = match.index ?? 0;
  const from = Math.max(0, at - 30);
  const slice = text.slice(from, at + match[0].length + 30).replace(/\s+/g, " ").trim();
  return slice.slice(0, 70);
}
