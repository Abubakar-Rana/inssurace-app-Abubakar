/**
 * Database access. Every tenant-scoped query goes through `withTenant`.
 *
 * Security L3: RLS policies in db/rls.sql read `certflow.tenant_id` from the
 * connection. `withTenant` opens a transaction, sets that variable with
 * SET LOCAL (so it is scoped to the transaction and cannot leak to the next
 * caller on a pooled connection), and runs your callback inside it.
 *
 * The practical effect: a query that forgets its tenant filter returns zero
 * rows instead of another agency's data. Isolation stops depending on every
 * developer remembering a WHERE clause.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";

declare global {
  // eslint-disable-next-line no-var
  var __certflowSql: ReturnType<typeof postgres> | undefined;
}

function connection() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  // Reuse across hot reloads in dev, otherwise every edit leaks a pool.
  globalThis.__certflowSql ??= postgres(url, { max: 10, prepare: false });
  return globalThis.__certflowSql;
}

/** Unscoped handle. Only for migrations, seeds, and the tenant lookup that
 *  necessarily happens before a tenant context exists. Never use it to serve a
 *  request — it bypasses nothing, but it carries no tenant filter either. */
export const db = drizzle(connection(), { schema });

/** The raw postgres.js handle, for things drizzle does not model — LISTEN/NOTIFY. */
export const sqlClient = connection();

export type Db = typeof db;
export type TenantDb = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Run `fn` with RLS pinned to one tenant.
 *
 *   const rows = await withTenant(tenantId, (tx) =>
 *     tx.select().from(clients)          // no manual tenant filter needed
 *   );
 */
export async function withTenant<T>(tenantId: string, fn: (tx: TenantDb) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) {
    throw new Error("withTenant requires a UUID tenant id.");
  }
  return db.transaction(async (tx) => {
    // set_config(..., true) == SET LOCAL: reverts when the transaction ends.
    await tx.execute(sql`select set_config('certflow.tenant_id', ${tenantId}, true)`);
    // The connection user (e.g. Supabase "postgres") has BYPASSRLS, so the
    // policies above only bind once we drop to the application role. With
    // DB_ENFORCE_RLS=1 every tenant transaction runs as certflow_app and the
    // DATABASE refuses cross-agency rows — not just our WHERE clauses.
    // SET LOCAL: reverts at commit, so a pooled connection never keeps it.
    if (process.env.DB_ENFORCE_RLS === "1") {
      await tx.execute(sql`set local role certflow_app`);
    }
    return fn(tx);
  });
}

export { schema };
