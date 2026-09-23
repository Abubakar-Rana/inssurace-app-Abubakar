/**
 * Run a NowCerts sync for one agency from the command line.
 *
 *   npm run nowcerts:sync -- --tenant whittington
 *
 * Uses the credentials the agency saved in Settings → Data source. Prints
 * counts only — never names, numbers or credentials.
 */

import "@/lib/env";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/db/schema";
import { syncTenant } from "@/lib/nowcerts/sync";

async function main() {
  const i = process.argv.indexOf("--tenant");
  const slug = i > -1 ? process.argv[i + 1] : undefined;
  if (!slug) throw new Error("Usage: npm run nowcerts:sync -- --tenant <agency-short-name>");
  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug));
  if (!tenant) throw new Error(`No agency "${slug}".`);
  const stats = await syncTenant(tenant.id);
  console.log(stats);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
