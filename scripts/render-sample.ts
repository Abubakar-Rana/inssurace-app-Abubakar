/**
 * Renders the seeded certificate to a real PDF so it can be held beside
 * COI_TRUCK_SOLUTION.PDF and compared by eye.
 *
 * verify-assembly.ts proves the *values* are right; this proves they land in
 * the right *boxes*. Both are needed before showing anything to ACORD.
 *
 *   npx tsx scripts/render-sample.ts
 *   -> out/certificate.pdf
 */

import "@/lib/env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, withTenant } from "@/lib/db/client";
import { certificateHolders, clients, tenants } from "@/db/schema";
import { loadCertificate } from "@/lib/certificate/load";
import { SAMPLE_INCLUDE_VINS, sampleHolder } from "./sampleFixture";
import { buildCertificatePdf } from "@/lib/acordPdf";

async function main() {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, "whittington"));
  if (!tenant) throw new Error("Tenant not seeded. Run: npm run db:seed");

  const { client, holder } = await withTenant(tenant.id, async (tx) => {
    const [client] = await tx.select().from(clients).limit(1);
    return { client, holder: await sampleHolder(tx, tenant.id) };
  });

  const cert = await loadCertificate({
    tenantId: tenant.id,
    clientId: client.id,
    holderId: holder.id,
    certificateNumber: "",
    issueDate: "07/16/2026",
    authorizedRep: "Jessica Whittington Smith",
    acordEdition: tenant.acordEdition,
    includeVins: SAMPLE_INCLUDE_VINS,
  });

  const pub = (name: string) => readFileSync(join(process.cwd(), "public", name));
  const bytes = await buildCertificatePdf(cert, pub("acord25-blank.pdf"), pub("acord101-blank.pdf"));

  mkdirSync(join(process.cwd(), "out"), { recursive: true });
  const dest = join(process.cwd(), "out", "certificate.pdf");
  writeFileSync(dest, bytes);
  console.log(`wrote ${dest} (${bytes.length} bytes)`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
