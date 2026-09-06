/**
 * Proof that the database fills the ACORD 25 correctly.
 *
 * Reads the seeded tenant, runs the deterministic assembler, and prints every
 * field beside the value on COI_TRUCK_SOLUTION.PDF. This is the artefact to put
 * in front of ACORD: no AI, no email, no hand-entry — a database row becomes a
 * certificate field.
 *
 *   npx tsx scripts/verify-assembly.ts
 */

import "@/lib/env";
import { eq } from "drizzle-orm";
import { db, withTenant } from "@/lib/db/client";
import { clients, tenants } from "@/db/schema";
import { SAMPLE_INCLUDE_VINS, sampleHolder } from "./sampleFixture";
import { loadCertificate } from "@/lib/certificate/load";

/** Ground truth, transcribed from COI_TRUCK_SOLUTION.PDF. */
const EXPECTED: Record<string, string> = {
  "producer.name": "Whittington Agency, LLC",
  "producer.contactName": "Certificate Department",
  "producer.phone": "336-390-1319",
  "producer.fax": "336-441-5555",
  "producer.email": "certificates@whittingtonagency.com",
  "insured.name": "Smart Way Solutions Inc",
  "insurers[0]": "A: National General Insurance Company (23728)",
  "coverages.auto.insrLtr": "A",
  "coverages.auto.policyNumber": "2026256248",
  "coverages.auto.eff": "12/26/2025",
  "coverages.auto.exp": "12/26/2026",
  "coverages.auto.scope": "scheduled",
  "coverages.auto.limits.combinedSingle": "1,000,000",
  "coverages.other[0].label": "Motor Truck Cargo",
  "coverages.other[1].label": "Physical Damage",
  "holder.name": "DAT Solutions LLC",
  date: "07/16/2026",
};

function get(obj: unknown, path: string): string {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let cur: any = obj;
  for (const p of parts) cur = cur?.[p];
  if (cur == null) return "";
  return typeof cur === "object" ? JSON.stringify(cur) : String(cur);
}

async function main() {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, "whittington"));
  if (!tenant) throw new Error("Tenant not seeded. Run: npm run db:seed");

  // The holder and the VIN setting come from the shared sample fixture, not
  // from whatever is currently in the database — see scripts/sampleFixture.ts.
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
    // No hardcoded notes: the towing sentence now comes from
    // policies.operationsNote, so this proves the database supplies it.
  });

  // ---- field-by-field comparison ----
  let pass = 0;
  let fail = 0;
  console.log("\nFIELD                                  EXPECTED (from PDF)          GOT");
  console.log("-".repeat(100));

  for (const [path, expected] of Object.entries(EXPECTED)) {
    let got: string;
    if (path === "insurers[0]") {
      const i = cert.insurers[0];
      got = i ? `${i.letter}: ${i.name} (${i.naic})` : "";
    } else {
      got = get(cert, path);
    }
    const ok = got === expected;
    ok ? pass++ : fail++;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${path.padEnd(34)} ${expected.slice(0, 27).padEnd(28)} ${got.slice(0, 30)}`
    );
  }

  console.log("-".repeat(100));
  console.log(`${pass} passed, ${fail} failed\n`);

  // ---- overflow behaviour ----
  console.log("DESCRIPTION OF OPERATIONS (page 1):");
  for (const line of cert.descriptionOfOperations.split("\n")) console.log("   " + line);

  console.log(`\nACORD 101 overflow: ${cert.additionalRemarks.length} line(s)`);
  for (const line of cert.additionalRemarks) console.log("   " + line);

  console.log(`\nfree coverage rows used: ${cert.coverages.other.length}/3`);
  for (const row of cert.coverages.other) {
    console.log(`   ${row.insrLtr}  ${row.label.padEnd(20)} ${row.policyNumber}  ${row.eff}-${row.exp}  ${row.limitText}`);
  }

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
