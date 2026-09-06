/**
 * Read the CERTIFICATE HOLDER off the bottom of a request email.
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
  source: "signature" | "sender";
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
