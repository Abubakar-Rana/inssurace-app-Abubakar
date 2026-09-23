/**
 * Settle an ambiguous request by a federal identifier instead of a name.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE NUMBERS ARE THE RIGHT ANSWER
 *
 * Company names are not unique and never have been. "Smart Way Solutions Inc"
 * and "Smart Way Solutions LLC" can be two different carriers, with different
 * policies and different limits, and no amount of string comparison will
 * separate them — the strings really are that similar, and the resolver is
 * right to refuse.
 *
 * A USDOT number and an MC number are issued by the federal government to one
 * motor carrier each. They are exact, they are unambiguous, and a broker asking
 * for a certificate almost always has one to hand, because they needed it to
 * onboard the carrier in the first place.
 *
 * So when the name is not enough, the system asks for a number. Matching then
 * stops being a similarity judgement and becomes a lookup, which either finds
 * exactly one company or finds none.
 *
 * NO FUZZY MATCHING HERE, EVER. A near-miss on an identifier is not a near-miss
 * on a company; digits transposed in a DOT number name a completely unrelated
 * carrier. This module matches exactly or returns nothing.
 * ---------------------------------------------------------------------------
 */

import { and, eq, or } from "drizzle-orm";
import { withTenant, type TenantDb } from "@/lib/db/client";
import { clients } from "@/db/schema";

/**
 * What may sit between a label and its digits.
 *
 * People put the company name in the middle — "the MC number for Smartway
 * Solutions is: 1043790" — so this cannot be a fixed list of connecting words.
 * It has to accept ordinary prose. Three things bound it instead:
 *
 *   NO DIGITS. The gap can never step over one number to reach another.
 *
 *   NO SENTENCE END. A full stop, question mark, semicolon or newline stops
 *   the search. Without that, "I don't have the MC handy. Our policy is
 *   2026256248" reads the POLICY number as a motor carrier number and
 *   confidently selects the wrong company — which is worse than reading
 *   nothing, because nothing looks wrong afterwards.
 *
 *   NO COMPETING NOUN. If the gap runs into a word that names a different kind
 *   of number — policy, invoice, reference, phone — the match stops there. That
 *   is the same protection one sentence further in.
 *
 * A full stop IS allowed as part of an abbreviation ("No.", "num."), because
 * that is a real way to write it and cannot be a sentence boundary.
 */
export const COMPETING = String.raw`policy|policies|invoice|reference|ref|phone|tel|fax|account|acct|order|load|pro|zip|suite|ste|unit|vin`;

const GAP = String.raw`(?:(?!\b(?:${COMPETING})\b)[^\d\n.!?;:]|:(?!\d)|\b(?:nos?|num|number)\b\.)`;

/** How far a label may reach for its number. Room for a company name, not a paragraph. */
const GAP_LIMIT = 60;

/**
 * "DOT", "D.O.T.", "USDOT", "US DOT", "U.S. DOT".
 *
 * The trailing guard stops it firing inside an ordinary word — "dotted",
 * "dotson" — which would otherwise make any nearby number a DOT number.
 */
const DOT_LABEL = String.raw`\b(?:u\.?\s?s\.?[\s.]*)?d\.?\s?o\.?\s?t\.?(?![a-z])`;

/**
 * "MC", "M.C.", "MX", "FF", and the words spelled out.
 *
 * MX and FF are the same federal register under different prefixes and are
 * stored in the same column.
 */
const MC_LABEL = String.raw`\b(?:m\.?\s?c\.?|m\.?\s?x\.?|f\.?\s?f\.?|motor\s+carrier|docket)(?![a-z])`;

function labelled(label: string, digits: string): RegExp {
  return new RegExp(`${label}${GAP}{0,${GAP_LIMIT}}(${digits})\\b`, "i");
}

/** USDOT numbers are 5-9 digits; MC numbers are shorter. */
const DOT_RE = labelled(DOT_LABEL, String.raw`\d{5,9}`);
const MC_RE = labelled(MC_LABEL, String.raw`\d{4,9}`);

/**
 * The number first, the label after: "1084463 is our MC number".
 *
 * Less common but perfectly natural, and cheap to support. Same closed gap, so
 * it cannot reach back across a sentence either.
 */
const DOT_REVERSED = new RegExp(String.raw`\b(\d{5,9})\b${GAP}{0,${GAP_LIMIT}}${DOT_LABEL}`, "i");
const MC_REVERSED = new RegExp(String.raw`\b(\d{4,9})\b${GAP}{0,${GAP_LIMIT}}${MC_LABEL}`, "i");

export interface Identifiers {
  /** USDOT number, digits only. */
  dot?: string;
  /** Motor Carrier (MC/MX/FF) number, digits only. */
  mc?: string;
}

/**
 * Read the identifiers a reply contains.
 *
 * Pure: no database, no network.
 */
export function readIdentifiers(text: string): Identifiers {
  const found: Identifiers = {};
  if (!text) return found;

  // DOT is tried before MC so that "USDOT 3121884" cannot be read as an MC
  // number by the shorter label happening to sit inside it.
  const dot = text.match(DOT_RE) ?? text.match(DOT_REVERSED);
  if (dot) found.dot = dot[1];

  const mc = text.match(MC_RE) ?? text.match(MC_REVERSED);
  // "USDOT 3121884" contains no MC label, but a stray match on the same digits
  // would mean one number claiming to be both. The DOT reading wins.
  if (mc && mc[1] !== found.dot) found.mc = mc[1];

  return found;
}

export interface IdentifierMatch {
  clientId: string;
  clientNumber: string | null;
  legalName: string;
  /** Which identifier produced the match, for the audit entry. */
  matchedOn: "dot" | "mc";
}

/** Strip everything but digits, so "MC-1084463" and "1084463" compare equal. */
function digits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/**
 * Look up a client by DOT or MC number. Exact match only.
 *
 * Returns null when nothing matches, which is a normal outcome: the requester
 * may have given the number of a carrier this agency does not insure. That is
 * information worth telling them, not an error.
 */
export async function resolveByIdentifier(
  tenantId: string,
  ids: Identifiers,
  tx?: TenantDb
): Promise<IdentifierMatch | null> {
  const dot = digits(ids.dot);
  const mc = digits(ids.mc);
  if (!dot && !mc) return null;

  const run = async (tx: TenantDb): Promise<IdentifierMatch | null> => {
    const conditions = [];
    if (dot) conditions.push(eq(clients.dotNumber, dot));
    if (mc) conditions.push(eq(clients.mcNumber, mc));

    const rows = await tx
      .select({
        id: clients.id,
        clientNumber: clients.clientNumber,
        legalName: clients.legalName,
        dotNumber: clients.dotNumber,
        mcNumber: clients.mcNumber,
      })
      .from(clients)
      .where(and(eq(clients.status, "active"), conditions.length === 1 ? conditions[0] : or(...conditions)));

    if (rows.length !== 1) {
      // Zero is a miss. More than one means the agency's own records give the
      // same federal number to two companies, which is a data problem a human
      // must look at — picking one would be guessing at exactly the point this
      // module exists to stop guessing.
      return null;
    }

    const row = rows[0];
    return {
      clientId: row.id,
      clientNumber: row.clientNumber,
      legalName: row.legalName,
      matchedOn: dot && digits(row.dotNumber) === dot ? "dot" : "mc",
    };
  };

  return tx ? run(tx) : withTenant(tenantId, run);
}
