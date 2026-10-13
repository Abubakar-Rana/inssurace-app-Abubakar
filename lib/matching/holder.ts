/**
 * The CERTIFICATE HOLDER of a request.
 *
 * ---------------------------------------------------------------------------
 * THE RULE NOW: THE HOLDER IS WHAT THE REQUESTER STATED, OR WE ASK.
 *
 * `readHolderFromText` (below) reads a holder only where the requester says
 * one — "certificate holder: X", "please issue it to X", "list X as holder" —
 * and the LLM reader (lib/llm/certificateHolder.ts) widens the phrasings it can
 * read without being allowed to invent one. When nobody is named, the system
 * asks the requester (lib/matching/clarifyService.ts) instead of assuming.
 *
 * The signature reader `extractHolder` is kept, but it no longer decides the
 * holder: printing the sender's sign-off as the holder put "Hasnain Ahmed" on a
 * certificate whose email said "the certificate holder is Beaconhouse National
 * University". What follows is the original rationale for that reader.
 *
 * ---------------------------------------------------------------------------
 * (original) Read the CERTIFICATE HOLDER off the bottom of a request email.
 *
 * ---------------------------------------------------------------------------
 * WHY THE HOLDER IS THE ONE FIELD THAT COMES FROM THE EMAIL
 *
 * Everything else on an ACORD 25 describes the insured, and the insured's own
 * records are the only trustworthy source for it — see lib/matching/interpret.ts.
 * The holder is different. The holder is whoever asked, and the agency has no
 * record of them until they write in: a broker onboarding a carrier, a shipper
 * setting up a lane, a bank financing a tractor. Reading it from a stored list
 * means printing whichever holder happened to be seeded, which is how a
 * certificate ends up addressed to a company that never asked for it.
 *
 * So this file reads the signature block — and only the signature block, which
 * is exactly the region lib/matching/extract.ts throws away. The two are mirror
 * images on purpose:
 *
 *     extract.ts   reads ABOVE the sign-off   -> who the certificate is FOR
 *     holder.ts    reads BELOW the sign-off   -> who is ASKING for it
 *
 * That split is the safety property. A name in the signature can only ever
 * become the holder — the party the document is addressed to — and never the
 * insured, whose coverage the document actually asserts. The worst a bad read
 * here can do is address the certificate imperfectly, in a field the reviewer
 * is looking straight at before they click send.
 *
 * No AI. Same contract as the rest of lib/matching: text in, a candidate out,
 * replaceable by a model later without touching a caller.
 * ---------------------------------------------------------------------------
 */

import { eq, and } from "drizzle-orm";
import { certificateHolders } from "@/db/schema";
import type { TenantDb } from "@/lib/db/client";
import { wrapLine } from "@/lib/certificate/text";
import { messagesOf } from "@/lib/llm/messages";

export { FOLLOW_UP_SEPARATOR } from "@/lib/llm/messages";

export interface HolderInput {
  subject?: string | null;
  body?: string | null;
  fromAddr?: string | null;
  fromName?: string | null;
}

export interface HolderBlock {
  /** Printed bold in the holder box. */
  name: string;
  /** The remaining lines, newline-joined. May be "". */
  addressLines: string;
  /** Where it came from — shown to the reviewer, recorded in the audit entry. */
  source: "signature" | "sender" | "stated";
  evidence: string;
}

/**
 * Sign-offs that introduce a signature block.
 *
 * The LAST one wins, not the first: "Thanks" often appears mid-body ("Thanks
 * for the quick turnaround"), whereas the block we want is at the very bottom.
 */
const SIGN_OFF =
  /^[ \t]*(?:--+|thanks(?:\s+again)?|thank you|many thanks|regards|kind regards|warm regards|best regards|best wishes|best|sincerely|cheers|respectfully|yours truly)[,!.]?[ \t]*$/gim;

/** Everything after one of these is no longer the sender's identity. */
const BLOCK_END =
  /^[ \t]*(?:>|on .+ wrote:|from:|sent:|to:|subject:|-{3,}\s*original message|_{5,}|confidentiality|this (?:e-?mail|message) (?:and|is|may)|disclaimer\b|notice:|unsubscribe|sent from my |get outlook for )/i;

/**
 * Lines that are contact details rather than an address.
 *
 * The ACORD holder box is a postal address block. A phone number or a signature
 * image alt-text in it is noise, and there are only four lines to spend.
 */
const NOT_ADDRESS =
  /^(?:[\w.+-]+@[\w.-]+\.\w+|(?:tel|phone|mobile|cell|direct|office|fax|t|m|p|o|f|e|w)[:.]?\s*[+\d(].*|\+?[\d\s().-]{7,}|(?:https?:\/\/|www\.)\S+|\[?(?:cid:|image\d)\S*\]?)$/i;

/** How many lines the holder box can actually print: name + four address rows. */
const MAX_LINES = 5;

/** Width of the holder box in points, from lib/acordMap.js. */
const BOX_WIDTH = 246;
const NAME_SIZE = 10;
const ADDRESS_SIZE = 9;

/**
 * Pull the holder out of an email.
 *
 * Never returns empty: with no signature it falls back to the sender's display
 * name and address, which is still the requester and still beats a stranger
 * pulled from a table.
 */
export function extractHolder(email: HolderInput): HolderBlock {
  const body = email.body ?? "";

  // Find the last sign-off, and read what follows it.
  SIGN_OFF.lastIndex = 0;
  let signOffEnd = -1;
  let signOffText = "";
  for (const match of body.matchAll(SIGN_OFF)) {
    signOffEnd = (match.index ?? 0) + match[0].length;
    signOffText = match[0].trim();
  }

  if (signOffEnd >= 0) {
    const lines: string[] = [];
    for (const raw of body.slice(signOffEnd).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) {
        // A blank line before anything was collected is just spacing after the
        // sign-off; one after the block has started ends it.
        if (lines.length) break;
        continue;
      }
      if (BLOCK_END.test(line)) break;
      if (NOT_ADDRESS.test(line)) continue;
      lines.push(line);
      if (lines.length >= MAX_LINES) break;
    }

    if (lines.length) {
      return {
        name: lines[0],
        addressLines: fitAddress(lines.slice(1)),
        source: "signature",
        evidence: `signature after "${signOffText}"`,
      };
    }
  }

  // No usable signature. The envelope still identifies the requester.
  const from = (email.fromAddr ?? "").trim();
  const display = (email.fromName ?? "").trim();
  return {
    name: display || from || "Certificate holder",
    addressLines: display && from ? from : "",
    source: "sender",
    evidence: from ? `sender ${from}` : "no signature and no sender",
  };
}

/**
 * Hard-wrap to the holder box, as everything stored for this form is.
 *
 * The renderers do not re-wrap — see the note in CLAUDE.md — so a company name
 * wider than the box has to be broken here or it would run past the rule.
 */
function fitAddress(lines: string[]): string {
  return lines
    .flatMap((line) => wrapLine(line, BOX_WIDTH, ADDRESS_SIZE))
    .slice(0, MAX_LINES - 1)
    .join("\n");
}

/** The name line is bold and slightly larger, so it wraps at its own size. */
export function fitHolderName(name: string): string {
  return wrapLine(name, BOX_WIDTH, NAME_SIZE, "bold")[0] ?? name;
}

/**
 * Find or create the `certificate_holders` row for a block.
 *
 * Holders repeat — the same broker requests constantly, which is why the table
 * exists — so an identical block reuses its row rather than accumulating a
 * duplicate per email. Matching on the full block, not just the name, keeps two
 * different people at the same brokerage distinct: the certificate names one of
 * them, and quietly swapping it for a colleague would be wrong.
 *
 * Requires an open tenant transaction; RLS scopes both statements.
 */
export async function upsertHolder(
  tx: TenantDb,
  tenantId: string,
  block: HolderBlock,
  email?: string | null
): Promise<string> {
  const name = fitHolderName(block.name);

  const [existing] = await tx
    .select({ id: certificateHolders.id })
    .from(certificateHolders)
    .where(
      and(
        eq(certificateHolders.name, name),
        eq(certificateHolders.addressLines, block.addressLines)
      )
    )
    .limit(1);
  if (existing) return existing.id;

  const [row] = await tx
    .insert(certificateHolders)
    .values({ tenantId, name, addressLines: block.addressLines, email: email ?? null })
    .returning({ id: certificateHolders.id });

  return row.id;
}

// ---------------------------------------------------------------------------
// THE HOLDER THE REQUESTER STATED
//
// Read only where the requester SAYS who the holder is. Anything weaker — a
// company merely mentioned, the sender's own sign-off — is not a statement, and
// the answer to "nobody was named" is a question to the requester, not a guess.
// ---------------------------------------------------------------------------

export interface StatedHolder {
  /** As the requester wrote it. "" when nobody was named. */
  name: string;
  /** An email given FOR the holder. Not asked for; kept when the model reads one. */
  email: string;
  /** Hard-wrapped to the holder box. May be "". */
  addressLines: string;
  /** Name and email both present — the model reader's contract. */
  complete: boolean;
  evidence: string;
}

export const NO_HOLDER: StatedHolder = {
  name: "",
  email: "",
  addressLines: "",
  complete: false,
  evidence: "no certificate holder stated",
};

/** The fill-in lines of our question. They are ours, so never an answer. */
export const HOLDER_QUESTION_LINES = ["Certificate holder name:", "Certificate holder address (optional):"];

export function fitHolderAddress(lines: string[]): string {
  return fitAddress(lines);
}

/** Answers that name nobody: "us", "same as last time", "our company". */
const NOT_A_NAME =
  /^(?:us|we|me|myself|you|yourself|them|they|it|this|that|same|the same|same as (?:before|last time|usual|previous|the last one)|as before|the usual|usual|n\/?a|none|nil|nobody|tbd|tba|to be (?:determined|confirmed)|unknown|insured|the insured|the carrier|the broker|the shipper|holder|the holder|certificate holder)$/i;

export function isNotAHolderName(name: string): boolean {
  const n = name.trim().replace(/[.!,;:]+$/, "").trim();
  return !n || NOT_A_NAME.test(n) || /^(?:our|my|your)\b/i.test(n);
}

/** A policy holder, lien holder, account holder… — never the certificate holder. */
const OTHER_KIND = /\b(?:policy|lien|account|title|card|license|licence|record|stake|share|bond|key)[\s-]?$/i;

/**
 * "certificate holder is: X", "COI holder name - X", "Holder: X",
 * "the holder should be X". `(.*)` is the rest of the line.
 */
const HOLDER_LABEL =
  /\b(?:(?:certificate|cert\.?|coi)\s+)?holder(?:'?s)?(?:\s+name)?\s*(?:(?:is|should\s+be|will\s+be|would\s+be|=)\b\s*[:\-–—]?|[:\-–—])\s*(.*)$/i;
/** "list X as (the) certificate holder" */
const AS_HOLDER =
  /\b(?:list|name|show|add|put|use|include)\s+(.+?)\s+as\s+(?:the\s+|a\s+)?(?:certificate\s+|cert\.?\s+|coi\s+)?holder\b/i;
const OBJECT = String.raw`(?:(?:it|this|that|one|them|(?:the|a|an)\s+(?:certificate|cert|coi)(?:\s+of\s+insurance)?)\s+)?`;
/** "issue it to X", "issued to X" */
const ISSUE_TO = new RegExp(String.raw`\b(?:issue[ds]?|issuing)\s+${OBJECT}to\s+(.+)$`, "i");
/** "make it out to X", "made out to X" */
const MADE_OUT = new RegExp(String.raw`\b(?:make|made|making|write|written)\s+${OBJECT}out\s+to\s+(.+)$`, "i");
/** The holder's address when labelled — including our own question's field. */
const ADDRESS_LABEL =
  /\b(?:(?:certificate|cert\.?|coi)\s+)?holder(?:'?s)?\s+address(?:\s*\(optional\))?\s*[:\-–—]\s*(.*)$/i;

const SUFFIX_AFTER_COMMA = /^\s*(?:inc|llc|l\.l\.c|ltd|corp|co|company|limited|plc|pllc|pc|lp|llp)\b/i;
const STOP_PHRASE =
  /\s+(?:please|pls|thanks|thank\s+you|asap|kindly|so\s+that|as\s+soon\s+as|by\s+(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|end\s+of)|for\s+(?:the|their|our|my|this|your)\b)/i;

/** Trim a capture to a holder name, plus whatever followed a separating comma. */
function cleanHolderName(raw: string): { name: string; rest: string } {
  let text = raw.replace(/\s+/g, " ").trim().replace(/^["'“‘]+/, "");

  // Sentence end. A full stop after an abbreviation ("Inc.", "Co.") is not one.
  text = text.replace(/[!?;].*$/, "");
  const stop = text.search(/(?<!\b(?:inc|co|corp|ltd|llc|l\.l\.c|st|ave|no|dr|rd))\.(?:\s|$)/i);
  if (stop >= 0) text = text.slice(0, stop);
  const phrase = text.search(STOP_PHRASE);
  if (phrase >= 0) text = text.slice(0, phrase);

  // A comma ends the name unless it introduces a suffix ("ABC Logistics, LLC").
  let rest = "";
  for (let i = text.indexOf(","); i >= 0; i = text.indexOf(",", i + 1)) {
    if (!SUFFIX_AFTER_COMMA.test(text.slice(i + 1))) {
      rest = text.slice(i + 1).trim();
      text = text.slice(0, i);
      break;
    }
  }

  const name = text.replace(/["'”’]+$/, "").replace(/[\s,.:;-]+$/, "").trim();
  return { name, rest };
}

function validName(name: string): boolean {
  if (!name || name.length < 2 || name.length > 100) return false;
  if (!/[a-z]/i.test(name)) return false;
  if (/[@<>]/.test(name) || /https?:|www\./i.test(name)) return false;
  // A label (ours or theirs) is not a name.
  if (/\bholder\b/i.test(name)) return false;
  // "MC 1500002" answers the OTHER question.
  if (/^\s*(?:u\.?\s?s\.?\s*)?(?:d\.?o\.?t|m\.?c|m\.?x|f\.?f|usdot)\b/i.test(name)) return false;
  if ((name.match(/\d/g)?.length ?? 0) > name.length / 3) return false;
  return !isNotAHolderName(name);
}

const SIGN_OFF_LINE =
  /^[ \t]*(?:--+|thanks(?:\s+again)?|thank\s+you|many\s+thanks|regards|kind\s+regards|warm\s+regards|best\s+regards|best\s+wishes|best|sincerely|cheers|respectfully|yours\s+truly)[,!.]?[ \t]*$/i;

const PROSE_START =
  /^(?:please|pls|thanks|thank|we|i|i'm|im|can|could|would|kindly|let|hope|also|and|but|so|if|the\s+certificate|this|that|it)\b/i;

/** A line that can continue a holder block: an address, not prose. */
function looksLikeAddressLine(line: string): boolean {
  if (!line || line.length > 70 || line.split(/\s+/).length > 9) return false;
  if (/\?$/.test(line)) return false;
  if (SIGN_OFF_LINE.test(line) || BLOCK_END.test(line) || NOT_ADDRESS.test(line)) return false;
  if (/\bholder\b/i.test(line) || PROSE_START.test(line)) return false;
  // A sentence with no number in it is prose, not a street or a city line.
  if (/[.!]$/.test(line) && !/\d/.test(line)) return false;
  return true;
}

function splitAddress(rest: string): string[] {
  if (!rest || !/\d/.test(rest)) return [];
  return rest
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function addressLinesAfter(lines: string[], from: number): string[] {
  const out: string[] = [];
  for (let i = from; i < lines.length && out.length < MAX_LINES - 1; i++) {
    const line = lines[i].trim();
    if (!line || !looksLikeAddressLine(line)) break;
    out.push(line);
  }
  return out;
}

/**
 * The message without its signature block.
 *
 * The LAST sign-off, and only when what follows is short and names no holder:
 * "Thanks!" followed by a paragraph is courtesy, not a sign-off.
 */
function aboveSignature(message: string): string {
  const lines = message.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!SIGN_OFF_LINE.test(lines[i])) continue;
    const after = lines.slice(i + 1).filter((l) => l.trim());
    if (after.length > 7 || after.some((l) => /\bholder\b/i.test(l))) return message;
    return lines.slice(0, i).join("\n");
  }
  return message;
}

const GREETING =
  /^(?:hi|hello|hey|dear|good\s+(?:morning|afternoon|evening|day)|salam|assalam\w*|greetings|sure|ok(?:ay)?|yes|here\s+(?:it\s+is|you\s+go)|see\s+below|as\s+requested)\b[^\n]{0,40}$/i;

function looseLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/\(optional\)/, "")
    .replace(/[\s:]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isOurLabelLine(line: string): boolean {
  const loose = looseLabel(line);
  return HOLDER_QUESTION_LINES.some((l) => loose === looseLabel(l));
}

/** An address given under its own label, from line `from` on. */
function labelledAddressFrom(lines: string[], from: number): string[] {
  for (let k = from; k < lines.length; k++) {
    const m = lines[k].match(ADDRESS_LABEL);
    if (!m) continue;
    const value = (m[1] ?? "").trim();
    const block = value ? value.split(",").map((p) => p.trim()).filter(Boolean) : [];
    return [...block, ...addressLinesAfter(lines, k + 1)].filter((l) => !isOurLabelLine(l));
  }
  return [];
}

/**
 * The holder ONE message states, or NO_HOLDER.
 *
 * `bareAnswer`: the message is a reply to OUR holder question and nothing else,
 * so a name on its own — "ABC Logistics LLC" — is the answer. Never set it when
 * the insured was asked about in the same message: a bare company name could
 * then be the answer to that question instead.
 */
export function readStatedHolder(message: string, options: { bareAnswer?: boolean } = {}): StatedHolder {
  const lines = aboveSignature(message ?? "").split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ADDRESS_LABEL.test(line)) continue;

    for (const [re, kind] of [
      [HOLDER_LABEL, "stated as holder"],
      [AS_HOLDER, "listed as holder"],
      [ISSUE_TO, "issue to"],
      [MADE_OUT, "made out to"],
    ] as const) {
      const m = line.match(re);
      if (!m || m.index === undefined) continue;

      const before = line.slice(0, m.index);
      // "the policy holder is X" names the insured, not the certificate holder.
      if (re === HOLDER_LABEL && OTHER_KIND.test(before)) continue;
      // "the policy was issued to X" is about the policy.
      if ((re === ISSUE_TO || re === MADE_OUT) && /\b(?:polic(?:y|ies)|coverage|endorsement)\b/i.test(before)) continue;

      let capture = m[1] ?? "";
      let nameLine = i;
      if (!capture.trim() && re === HOLDER_LABEL) {
        // "Certificate holder:" ending the line — the name is on the next one.
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j >= lines.length || isOurLabelLine(lines[j]) || ADDRESS_LABEL.test(lines[j])) continue;
        capture = lines[j];
        nameLine = j;
      }

      const { name, rest } = cleanHolderName(capture);
      if (!validName(name) || isOurLabelLine(name)) continue;

      const block = [...splitAddress(rest), ...addressLinesAfter(lines, nameLine + 1)];
      return {
        name,
        email: "",
        addressLines: fitAddress(block.length ? block : labelledAddressFrom(lines, nameLine + 1)),
        complete: false,
        evidence: `${kind}: "${line.trim().slice(0, 90)}"`,
      };
    }
  }

  if (options.bareAnswer) {
    const content = lines
      .map((l) => l.trim())
      .filter((l) => l && !GREETING.test(l) && !isOurLabelLine(l) && !ADDRESS_LABEL.test(l));
    if (content.length >= 1 && content.length <= 5) {
      const first = content[0];
      const { name, rest } = cleanHolderName(first);
      const nameLike =
        first.split(/\s+/).length <= 8 && !/\?/.test(first) && !PROSE_START.test(first) && validName(name);
      if (nameLike) {
        const block = [...splitAddress(rest), ...content.slice(1).filter(looksLikeAddressLine)];
        return {
          name,
          email: "",
          addressLines: fitAddress(block.length ? block : labelledAddressFrom(lines, 0)),
          complete: false,
          evidence: "the requester's answer to our holder question",
        };
      }
    }
  }

  return { ...NO_HOLDER };
}

/**
 * The holder a whole request body states. Follow-ups are joined onto the body,
 * so the LATEST message that names a holder wins — "actually, make it out to X"
 * replaces the earlier one.
 */
export function readHolderFromText(
  text: string | null | undefined,
  options: { bareAnswer?: boolean } = {}
): StatedHolder {
  const messages = messagesOf(text);
  for (let i = messages.length - 1; i >= 0; i--) {
    const holder = readStatedHolder(messages[i], options);
    if (holder.name) return holder;
  }
  return { ...NO_HOLDER };
}
