/**
 * Encrypt and decrypt one tenant's stored credentials (mail and NowCerts
 * passwords) with that tenant's own data key. (Security L1 / L2)
 *
 * The plaintext exists only in memory, only in the process about to use it
 * (the mailbox watcher, the sync job, a "test connection" click), and is never
 * returned by any route. A tenant with no key row cannot store secrets at all:
 * that is a provisioning bug, and failing loudly beats storing plaintext.
 */

import { eq } from "drizzle-orm";
import type { TenantDb } from "@/lib/db/client";
import { tenantKeys } from "@/db/schema";
import { decryptField, encryptField, unwrapDek } from "./envelope";

async function dekFor(tx: TenantDb, tenantId: string): Promise<Buffer> {
  const [row] = await tx.select().from(tenantKeys).where(eq(tenantKeys.tenantId, tenantId));
  if (!row || row.revokedAt) {
    throw new Error("This agency has no active encryption key. Contact Nestnic support.");
  }
  return unwrapDek(row.wrappedDek);
}

export async function sealSecret(tx: TenantDb, tenantId: string, plaintext: string): Promise<string> {
  return encryptField(await dekFor(tx, tenantId), plaintext);
}

export async function openSecret(tx: TenantDb, tenantId: string, packed: string): Promise<string> {
  return decryptField(await dekFor(tx, tenantId), packed);
}
