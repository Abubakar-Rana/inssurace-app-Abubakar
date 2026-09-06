/**
 * Delete Gmail-ingested requests and their stored bodies.
 *
 * The seeded demo requests (gmail_message_id like 'seed-%') are left alone.
 *
 * This is the manual form of the Security L6 retention promise — "email content
 * is purged" — which will become a scheduled job reading `purge_after`. Until
 * that exists, this is how you take real mail back out of the database.
 *
 *   npm run purge:ingested
 */

import "@/lib/env";
import { and, eq, isNull, not, sql } from "drizzle-orm";
import { db, withTenant } from "@/lib/db/client";
import { certificates, coiRequests, tenants } from "@/db/schema";

async function main() {
  const slug = process.env.DEV_TENANT_SLUG ?? "whittington";
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug));
  if (!tenant) throw new Error(`No tenant "${slug}".`);

  const removed = await withTenant(tenant.id, async (tx) => {
    const targets = await tx
      .select({ id: coiRequests.id, subject: coiRequests.subject })
      .from(coiRequests)
      .where(not(sql`${coiRequests.gmailMessageId} like 'seed-%'`));

    if (!targets.length) return 0;

    // A request with a certificate is real work; refuse to delete it silently.
    for (const t of targets) {
      const [cert] = await tx
        .select({ id: certificates.id })
        .from(certificates)
        .where(eq(certificates.requestId, t.id))
        .limit(1);
      if (cert) {
        throw new Error(
          `Request ${t.id} has a certificate — delete it deliberately, not with this script.`
        );
      }
    }

    await tx.delete(coiRequests).where(not(sql`${coiRequests.gmailMessageId} like 'seed-%'`));
    return targets.length;
  });

  console.log(`purged ${removed} ingested request(s); seeded demo requests kept.`);

  const left = await withTenant(tenant.id, async (tx) => {
    const rows = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(coiRequests)
      .where(and(not(isNull(coiRequests.bodyText))));
    return rows[0]?.n ?? 0;
  });
  console.log(`${left} request(s) still hold a stored body (the seeded demo set).`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
