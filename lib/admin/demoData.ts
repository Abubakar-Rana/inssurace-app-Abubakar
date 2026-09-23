/**
 * Demonstration data — the clients, policies and vehicles a new agency starts
 * with so the system can be shown working before any real data exists.
 *
 * WHY EVERY AGENCY GETS IT: with an empty database a request arrives, resolves
 * to nothing, and parks as "needs identifying". That looks broken to someone
 * being shown the product for the first time. With this loaded, a request for
 * one of these carriers produces a complete ACORD 25 end to end.
 *
 * RULES
 *  - Rows are marked `source: "demo"`, so the NowCerts sync (which only ever
 *    touches `source: "nowcerts"`) cannot change or retire them, and removing
 *    the demo set cannot touch anything real.
 *  - Removal refuses to delete a client that a certificate already references —
 *    an issued certificate must keep pointing at the insured it certified.
 *  - Insurers are national reference data, shared and never deleted here.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { withTenant, type TenantDb } from "@/lib/db/client";
import { certificates, clientAliases, clients, insurers, policies, vehicles } from "@/db/schema";
import { audit } from "@/lib/audit";

export const DEMO_SOURCE = "demo";

interface DemoInsurer {
  name: string;
  naic: string;
}

interface DemoCompany {
  key: string;
  legalName: string;
  aliases: string[];
  addressLines: string;
  dotNumber: string;
  mcNumber: string;
  clientNumber: string;
  insurer: DemoInsurer;
  policies: {
    kind: "cgl" | "auto" | "umbrella" | "workersComp" | "cargo" | "physDamage" | "other";
    label?: string;
    policyNumber: string;
    effDate: string;
    expDate: string;
    limits?: Record<string, string>;
    flags?: Record<string, string | boolean>;
    limitText?: string;
    addlInsd?: boolean;
    subrWvd?: boolean;
    operationsNote?: string;
  }[];
  vehicles: { year: number; make: string; model: string; vin: string; statedValue?: string }[];
}

/**
 * Three carriers with deliberately different shapes: a full trucking programme,
 * a small fleet with general liability, and a single-truck owner-operator. Dates
 * are generated around today so nothing expires while the product is being shown.
 */
function demoCompanies(): DemoCompany[] {
  const year = new Date().getUTCFullYear();
  const eff = `${year}-01-01`;
  const exp = `${year + 1}-01-01`;

  return [
    {
      key: "smart-way",
      legalName: "Smart Way Solutions Inc",
      aliases: ["Smartway Solutions", "Smart Way Solutions"],
      addressLines: "4932 Spruce Peak Rd\nCharlotte, NC 28278",
      dotNumber: "3121884",
      mcNumber: "1084463",
      clientNumber: "SWS-1001",
      insurer: { name: "National General Insurance Company", naic: "11430" },
      policies: [
        {
          kind: "auto",
          policyNumber: `CA-${year}-104821`,
          effDate: eff,
          expDate: exp,
          flags: { scope: "scheduled" },
          limits: { combinedSingle: "1000000" },
          addlInsd: true,
          operationsNote:
            "Certificate holder is named as additional insured with respect to auto liability where required by written contract.",
        },
        { kind: "cargo", label: "Motor Truck Cargo", policyNumber: `MTC-${year}-104821`, effDate: eff, expDate: exp, limitText: "Limit: $100,000, Deductible: $2,500" },
        { kind: "physDamage", label: "Physical Damage", policyNumber: `PD-${year}-104821`, effDate: eff, expDate: exp, limitText: "Deductibles - Comp: $2,500, Coll: $2,500" },
      ],
      vehicles: [
        { year: 2019, make: "HINO", model: "Conventional Type Truck", vin: "5PVNE8JV5K4S56954", statedValue: "18250" },
        { year: 2020, make: "HINO", model: "258/268", vin: "5PVNJ8JV3L4S77508", statedValue: "32000" },
        { year: 2016, make: "HINO", model: "258/268", vin: "5PVNJ8JV3G4S61847", statedValue: "25000" },
        { year: 2015, make: "HINO", model: "258/268", vin: "5PVNJ8JV7F4S59601", statedValue: "25000" },
        { year: 2014, make: "HINO", model: "258/268", vin: "5PVNJ8JTXE4S55345", statedValue: "20000" },
        { year: 2016, make: "HINO", model: "Conventional Type Truck", vin: "5PVNJ8JV8G4S60838", statedValue: "22000" },
      ],
    },
    {
      key: "meridian",
      legalName: "Meridian Logistics LLC",
      aliases: ["Meridian Logistics"],
      addressLines: "1180 Innovation Way\nCharlotte, NC 28273",
      dotNumber: "2884517",
      mcNumber: "998214",
      clientNumber: "MRD-1002",
      insurer: { name: "Progressive Commercial", naic: "24260" },
      policies: [
        {
          kind: "cgl",
          policyNumber: `GL-${year}-7789021`,
          effDate: eff,
          expDate: exp,
          flags: { form: "occur", aggregatePer: "policy" },
          limits: {
            eachOccurrence: "1000000",
            damageToRented: "100000",
            medExp: "5000",
            personalAdvInjury: "1000000",
            generalAggregate: "2000000",
            productsCompOp: "2000000",
          },
          addlInsd: true,
        },
        {
          kind: "auto",
          policyNumber: `CA-${year}-3391847`,
          effDate: eff,
          expDate: exp,
          flags: { scope: "any" },
          limits: { combinedSingle: "1000000" },
          subrWvd: true,
        },
      ],
      vehicles: [
        { year: 2022, make: "FREIGHTLINER", model: "Cascadia", vin: "3AKJHHDR9NSNK3821", statedValue: "145000" },
        { year: 2021, make: "UTILITY", model: "3000R Reefer", vin: "1UYVS2538M2914773", statedValue: "68000" },
      ],
    },
    {
      key: "bluecreek",
      legalName: "Blue Creek Hauling LLC",
      aliases: ["Blue Creek Hauling", "Bluecreek Hauling"],
      addressLines: "77 Commerce Park Dr\nHuntersville, NC 28078",
      dotNumber: "3702118",
      mcNumber: "1268430",
      clientNumber: "BCH-1003",
      insurer: { name: "The Hartford", naic: "29424" },
      policies: [
        {
          kind: "auto",
          policyNumber: `CA-${year}-556231`,
          effDate: eff,
          expDate: exp,
          flags: { scope: "owned" },
          limits: { combinedSingle: "750000" },
        },
        {
          kind: "workersComp",
          policyNumber: `WC-${year}-889201`,
          effDate: eff,
          expDate: exp,
          flags: { perStatute: true },
          limits: { eachAccident: "1000000", diseaseEmployee: "1000000", diseasePolicy: "1000000" },
        },
      ],
      vehicles: [{ year: 2018, make: "PETERBILT", model: "579", vin: "1XPBD49X4JD447215", statedValue: "82000" }],
    },
  ];
}

async function insurerId(tx: TenantDb, name: string, naic: string): Promise<string> {
  const [existing] = await tx.select({ id: insurers.id }).from(insurers).where(eq(insurers.naic, naic));
  if (existing) return existing.id;
  const [created] = await tx.insert(insurers).values({ name, naic }).onConflictDoNothing().returning({ id: insurers.id });
  if (created) return created.id;
  const [raced] = await tx.select({ id: insurers.id }).from(insurers).where(eq(insurers.naic, naic));
  return raced.id;
}

export interface DemoDataStatus {
  loaded: boolean;
  clients: number;
  policies: number;
  vehicles: number;
}

export async function demoDataStatus(tenantId: string): Promise<DemoDataStatus> {
  return withTenant(tenantId, async (tx) => {
    const count = async (table: typeof clients | typeof policies | typeof vehicles) => {
      const [row] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(and(eq(table.tenantId, tenantId), eq(table.source, DEMO_SOURCE)));
      return row?.n ?? 0;
    };
    const [c, p, v] = [await count(clients), await count(policies), await count(vehicles)];
    return { loaded: c > 0, clients: c, policies: p, vehicles: v };
  });
}

/**
 * Load (or reload) the demo set. Idempotent: an existing demo client is updated
 * in place and its demo policies/vehicles replaced, so running it twice does not
 * duplicate anything. Real and NowCerts rows are never touched.
 */
export async function loadDemoData(
  tenantId: string,
  actor?: { userId: string | null; by?: string }
): Promise<DemoDataStatus> {
  await withTenant(tenantId, async (tx) => {
    for (const company of demoCompanies()) {
      const externalId = `demo:${company.key}`;
      const values = {
        clientNumber: company.clientNumber,
        legalName: company.legalName,
        addressLines: company.addressLines,
        dotNumber: company.dotNumber,
        mcNumber: company.mcNumber,
        status: "active",
      };

      const [existing] = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.source, DEMO_SOURCE), eq(clients.externalId, externalId)));

      let clientId: string;
      if (existing) {
        await tx.update(clients).set(values).where(eq(clients.id, existing.id));
        clientId = existing.id;
        // Replace this client's demo policies and vehicles rather than
        // accumulating copies of them.
        await tx.delete(policies).where(and(eq(policies.clientId, clientId), eq(policies.source, DEMO_SOURCE)));
        await tx.delete(vehicles).where(and(eq(vehicles.clientId, clientId), eq(vehicles.source, DEMO_SOURCE)));
        await tx.delete(clientAliases).where(eq(clientAliases.clientId, clientId));
      } else {
        const [row] = await tx
          .insert(clients)
          .values({ tenantId, source: DEMO_SOURCE, externalId, ...values })
          .returning({ id: clients.id });
        clientId = row.id;
      }

      if (company.aliases.length) {
        await tx.insert(clientAliases).values(company.aliases.map((alias) => ({ tenantId, clientId, alias })));
      }

      const insurer = await insurerId(tx, company.insurer.name, company.insurer.naic);
      for (const [i, p] of company.policies.entries()) {
        await tx.insert(policies).values({
          tenantId,
          source: DEMO_SOURCE,
          externalId: `${externalId}:${i}`,
          clientId,
          insurerId: insurer,
          kind: p.kind,
          label: p.label ?? null,
          policyNumber: p.policyNumber,
          effDate: p.effDate,
          expDate: p.expDate,
          addlInsd: p.addlInsd ?? false,
          subrWvd: p.subrWvd ?? false,
          limits: p.limits ?? {},
          flags: p.flags ?? {},
          limitText: p.limitText ?? null,
          operationsNote: p.operationsNote ?? null,
          status: "active",
        });
      }

      for (const [i, v] of company.vehicles.entries()) {
        await tx.insert(vehicles).values({
          tenantId,
          source: DEMO_SOURCE,
          externalId: `${externalId}:v${i}`,
          clientId,
          year: v.year,
          make: v.make,
          model: v.model,
          vin: v.vin,
          statedValue: v.statedValue ?? null,
          deductibleComp: "2500",
          deductibleColl: "2500",
          sortOrder: i,
        });
      }
    }

    await audit(tx, {
      tenantId,
      actorUserId: actor?.userId ?? null,
      action: "demo_data.loaded",
      subjectType: "tenant",
      subjectId: tenantId,
      after: { companies: demoCompanies().length, by: actor?.by ?? "system" },
    });
  });

  return demoDataStatus(tenantId);
}

/**
 * Remove the demo set. Any demo client that an issued certificate references is
 * kept but marked inactive, so it stops matching new requests while the
 * certificate it belongs to still resolves.
 */
export async function removeDemoData(
  tenantId: string,
  actor?: { userId: string | null; by?: string }
): Promise<{ removed: number; keptForCertificates: number }> {
  return withTenant(tenantId, async (tx) => {
    const demoClients = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.tenantId, tenantId), eq(clients.source, DEMO_SOURCE)));
    const ids = demoClients.map((c) => c.id);
    if (!ids.length) return { removed: 0, keptForCertificates: 0 };

    const referenced = await tx
      .select({ id: certificates.clientId })
      .from(certificates)
      .where(and(eq(certificates.tenantId, tenantId), inArray(certificates.clientId, ids)));
    const keep = new Set(referenced.map((r) => r.id));
    const deletable = ids.filter((id) => !keep.has(id));

    await tx.delete(policies).where(and(eq(policies.tenantId, tenantId), eq(policies.source, DEMO_SOURCE)));
    await tx.delete(vehicles).where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.source, DEMO_SOURCE)));
    if (deletable.length) await tx.delete(clients).where(inArray(clients.id, deletable));
    if (keep.size) {
      await tx.update(clients).set({ status: "inactive" }).where(inArray(clients.id, [...keep]));
    }

    await audit(tx, {
      tenantId,
      actorUserId: actor?.userId ?? null,
      action: "demo_data.removed",
      subjectType: "tenant",
      subjectId: tenantId,
      after: { removed: deletable.length, keptForCertificates: keep.size, by: actor?.by ?? "system" },
    });

    return { removed: deletable.length, keptForCertificates: keep.size };
  });
}
