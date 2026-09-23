/**
 * Load or remove the demonstration clients and policies for one agency.
 *
 *   npm run demo:load -- --tenant <agency-short-name>
 *   npm run demo:load -- --tenant <agency-short-name> --remove
 *
 * New agencies get this automatically; this is for agencies created earlier.
 */

import "@/lib/env";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/db/schema";
import { loadDemoData, removeDemoData } from "@/lib/admin/demoData";

async function main() {
  const i = process.argv.indexOf("--tenant");
  const slug = i > -1 ? process.argv[i + 1] : undefined;
  if (!slug) throw new Error("Usage: npm run demo:load -- --tenant <agency-short-name> [--remove]");

  const [tenant] = await db.select({ id: tenants.id, name: tenants.name }).from(tenants).where(eq(tenants.slug, slug));
  if (!tenant) throw new Error(`No agency "${slug}".`);

  if (process.argv.includes("--remove")) {
    console.log(`${tenant.name}:`, await removeDemoData(tenant.id));
  } else {
    console.log(`${tenant.name}:`, await loadDemoData(tenant.id));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
