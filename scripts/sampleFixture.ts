/**
 * The fixture that reproduces COI_TRUCK_SOLUTION.PDF.
 *
 * Shared by `npm run verify` and `npm run render`, which must agree: the first
 * proves the fields are right and the second draws them. If they sourced their
 * inputs separately they could drift, and the proof would stop describing the
 * document the render step actually produces.
 *
 * Two things are pinned here rather than read from whatever happens to be in
 * the database:
 *
 *   THE HOLDER. Certificate holders are now derived per-request from the
 *   requester's email signature, so "the first holder row" is whatever mail was
 *   last ingested. The sample's holder is a stored postal address, which is
 *   still a real case — an agency that already has the broker on file prints
 *   the address it holds, not three lines of a signature.
 *
 *   VINs. They are omitted from a draft unless the request asked for them, but
 *   the sample document lists them, so this fixture asks for them explicitly.
 *   Anything reproducing that document must do the same or the fleet block will
 *   not match.
 */

import { and, eq } from "drizzle-orm";
import { certificateHolders } from "@/db/schema";
import type { TenantDb } from "@/lib/db/client";

/** The sample document lists VINs, so reproducing it requires them. */
export const SAMPLE_INCLUDE_VINS = true;

export const SAMPLE_HOLDER = {
  name: "DAT Solutions LLC",
  addressLines: ["10260 SW Greenburg Rd", "Suite 464", "Tigard, OR 97223-5500"].join("\n"),
};

/** Find or create the sample's certificate holder. Requires an open tenant tx. */
export async function sampleHolder(tx: TenantDb, tenantId: string) {
  const [existing] = await tx
    .select()
    .from(certificateHolders)
    .where(
      and(
        eq(certificateHolders.name, SAMPLE_HOLDER.name),
        eq(certificateHolders.addressLines, SAMPLE_HOLDER.addressLines)
      )
    )
    .limit(1);
  if (existing) return existing;

  const [created] = await tx
    .insert(certificateHolders)
    .values({ tenantId, ...SAMPLE_HOLDER })
    .returning();
  return created;
}
