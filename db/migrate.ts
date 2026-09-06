/**
 * Applies drizzle migrations, then the hand-written security policies.
 *
 * Order matters: db/rls.sql attaches policies to tables, so the tables must
 * exist first. Both steps are idempotent — safe to re-run.
 *
 *   npm run db:generate   # after editing db/schema.ts
 *   npm run db:migrate
 */

import "@/lib/env";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");

  // max:1 — migrations must run serially on one connection.
  const sql = postgres(url, { max: 1 });

  try {
    console.log("applying schema migrations…");
    await migrate(drizzle(sql), { migrationsFolder: "./db/migrations" });

    console.log("applying row-level security policies…");
    await sql.unsafe(readFileSync(join(process.cwd(), "db", "rls.sql"), "utf8"));

    console.log("done.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
