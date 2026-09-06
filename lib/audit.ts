/**
 * Append to the immutable audit log (Security L4).
 *
 * Each entry stores the hash of the one before it, so altering or removing any
 * entry breaks every hash that follows. The database already revokes UPDATE and
 * DELETE from the application role (db/rls.sql); the chain is what makes
 * tampering *detectable* rather than merely forbidden — including by someone
 * with direct database access.
 *
 * Records references and hashes, never content. Putting an email body or a
 * certificate snapshot in here would make the 30-day purge (L6) impossible and
 * turn the audit log into the PII store it exists to avoid.
 */

import { createHash } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { auditLog } from "@/db/schema";
import type { TenantDb } from "@/lib/db/client";

export interface AuditEntry {
  tenantId: string;
  actorUserId: string | null;
  action: string;
  subjectType: string;
  subjectId: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/** Stable key order, so the same entry always hashes to the same digest. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

/**
 * Append one entry. MUST be called inside the same transaction as the change it
 * describes, so an action can never be recorded without happening, or happen
 * without being recorded.
 */
export async function audit(tx: TenantDb, entry: AuditEntry): Promise<string> {
  // Serialise appends for this tenant. Without it two concurrent writers could
  // read the same predecessor and fork the chain. Released at commit.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${entry.tenantId}))`);

  const [prev] = await tx
    .select({ hash: auditLog.hash })
    .from(auditLog)
    .where(eq(auditLog.tenantId, entry.tenantId))
    .orderBy(desc(auditLog.seq))
    .limit(1);

  const prevHash = prev?.hash ?? null;
  const payload = {
    tenantId: entry.tenantId,
    actorUserId: entry.actorUserId,
    action: entry.action,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId,
    before: entry.before ?? null,
    after: entry.after ?? null,
  };
  const hash = createHash("sha256")
    .update(`${prevHash ?? ""}\n${canonical(payload)}`)
    .digest("hex");

  await tx.insert(auditLog).values({
    ...payload,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
    prevHash,
    hash,
  });

  return hash;
}

/**
 * Walk a tenant's chain and report the first entry whose hash does not follow
 * from its predecessor. Returns null when the chain is intact.
 */
export async function verifyAuditChain(
  tx: TenantDb,
  tenantId: string
): Promise<{ seq: number; reason: string } | null> {
  const rows = await tx
    .select()
    .from(auditLog)
    .where(eq(auditLog.tenantId, tenantId))
    .orderBy(auditLog.seq);

  let expectedPrev: string | null = null;
  for (const row of rows) {
    if (row.prevHash !== expectedPrev) {
      return { seq: row.seq, reason: "prev_hash does not match the preceding entry" };
    }
    const recomputed: string = createHash("sha256")
      .update(
        `${row.prevHash ?? ""}\n${canonical({
          tenantId: row.tenantId,
          actorUserId: row.actorUserId,
          action: row.action,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          before: row.before ?? null,
          after: row.after ?? null,
        })}`
      )
      .digest("hex");
    if (recomputed !== row.hash) {
      return { seq: row.seq, reason: "content does not match its recorded hash" };
    }
    expectedPrev = row.hash;
  }
  return null;
}
