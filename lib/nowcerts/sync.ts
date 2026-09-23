/**
 * Copy an agency's NowCerts clients, policies and vehicles into CertFlow.
 *
 * WHY COPY RATHER THAN READ LIVE: matching (pg_trgm over client names, exact
 * DOT/MC lookup) and assembly both read local tables. Keeping them local means
 * the proven pipeline is untouched, a NowCerts outage never stops a
 * certificate, and every issued certificate still snapshots what was true.
 *
 * RULES
 *  - Only rows with source = 'nowcerts' are ever created, changed or retired.
 *    Anything an agency entered by hand is invisible to this job.
 *  - A policy that disappears, expires or is cancelled in NowCerts is set
 *    `inactive`, never deleted: past certificates reference its client.
 *  - All writes for one run happen in ONE transaction. A sync that fails half
 *    way leaves yesterday's data, not half of today's.
 *  - Credentials are decrypted only for the run and never logged. The audit
 *    entry carries counts, not data.
 */

import { and, eq, notInArray, sql } from "drizzle-orm";
import { db, withTenant, type TenantDb } from "@/lib/db/client";
import { clients, insurers, policies, tenantNowcertsSettings, tenants, vehicles } from "@/db/schema";
import { audit } from "@/lib/audit";
import { openSecret } from "@/lib/crypto/tenantSecrets";
import { call, listAll, NowCertsError, rows, type Credentials } from "./client";
import {
  isCertifiable,
  mapCoverages,
  mapInsured,
  mapPolicyHeader,
  mapVehicle,
  type MappedClient,
  type MappedCoverage,
  type MappedPolicyHeader,
  type MappedVehicle,
} from "./map";

const CHUNK = 25;
const SOURCE = "nowcerts";

export interface SyncStats {
  policiesRead: number;
  policiesCertifiable: number;
  clients: number;
  coverageRows: number;
  vehicles: number;
  retiredPolicies: number;
  [key: string]: number;
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export async function credentialsFor(tenantId: string): Promise<Credentials | null> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(tenantNowcertsSettings)
      .where(eq(tenantNowcertsSettings.tenantId, tenantId));
    if (!row) return null;
    return { tenantId, username: row.username, password: await openSecret(tx, tenantId, row.passwordEnc) };
  });
}

// ---------------------------------------------------------------- fetch

export interface Fetched {
  headers: MappedPolicyHeader[];
  insureds: Map<string, MappedClient>;
  coverages: Map<string, MappedCoverage[]>;
  vehicles: MappedVehicle[];
  policiesRead: number;
}

async function fetchPolicies(c: Credentials) {
  try {
    return await listAll(c, "PolicyDetailList", { isActive: "true", $orderby: "changeDate desc" });
  } catch (err) {
    // Some accounts reject the ordering clause; paging still works without it.
    if (err instanceof NowCertsError && err.status === 400) return listAll(c, "PolicyDetailList", { isActive: "true" });
    throw err;
  }
}

async function fetchAll(c: Credentials): Promise<Fetched> {
  const today = new Date().toISOString().slice(0, 10);
  const raw = await fetchPolicies(c);

  const headers: MappedPolicyHeader[] = [];
  const insureds = new Map<string, MappedClient>();
  for (const r of raw) {
    const header = mapPolicyHeader(r);
    if (!header || !isCertifiable(header, today)) continue;
    const insured = mapInsured(r);
    if (!insured) continue;
    headers.push(header);
    insureds.set(insured.externalId, insured);
  }

  const coverages = new Map<string, MappedCoverage[]>();
  for (const ids of chunks(headers.map((h) => h.externalId), CHUNK)) {
    const response = await call(c, "GET", "Policy/Coverages", { json: { policyDataBaseId: ids } });
    for (const [policyId, list] of mapCoverages(response)) coverages.set(policyId, list);
  }

  // Vehicles only matter for policies that print an auto or physical-damage row.
  const withAutos = headers
    .filter((h) => (coverages.get(h.externalId) ?? []).some((cv) => cv.kind === "auto" || cv.kind === "physDamage"))
    .map((h) => h.externalId);
  const vehicleList: MappedVehicle[] = [];
  for (const ids of chunks(withAutos, CHUNK)) {
    const response = await call(c, "POST", "Policy/PolicyVehicles", { json: { PolicyDataBaseId: ids } });
    for (const r of rows(response)) {
      const v = mapVehicle(r, ids.length === 1 ? ids[0] : "");
      if (v) vehicleList.push(v);
    }
  }

  return { headers, insureds, coverages, vehicles: vehicleList, policiesRead: raw.length };
}

// ---------------------------------------------------------------- write

async function insurerId(tx: TenantDb, name: string, naic: string | null): Promise<string> {
  const label = name || "Unknown insurer";
  if (naic) {
    const [byNaic] = await tx.select({ id: insurers.id }).from(insurers).where(eq(insurers.naic, naic));
    if (byNaic) return byNaic.id;
  }
  const [byName] = await tx
    .select({ id: insurers.id })
    .from(insurers)
    .where(sql`lower(${insurers.name}) = lower(${label}) and ${naic ? sql`${insurers.naic} is null` : sql`true`}`)
    .limit(1);
  if (byName) {
    if (naic) await tx.update(insurers).set({ naic }).where(eq(insurers.id, byName.id));
    return byName.id;
  }
  const [created] = await tx
    .insert(insurers)
    .values({ name: label, naic })
    .onConflictDoNothing()
    .returning({ id: insurers.id });
  if (created) return created.id;
  const [raced] = await tx.select({ id: insurers.id }).from(insurers).where(eq(insurers.naic, naic!));
  return raced.id;
}

/** Exported for scripts/verify-saas-db.ts, which feeds it fixture data. */
export async function writeAll(tenantId: string, data: Fetched): Promise<SyncStats> {
  return withTenant(tenantId, async (tx) => {
    // ---- clients ----
    const existingClients = await tx
      .select({ id: clients.id, externalId: clients.externalId })
      .from(clients)
      .where(eq(clients.source, SOURCE));
    const clientIdByExt = new Map(existingClients.map((r) => [r.externalId!, r.id]));

    for (const c of data.insureds.values()) {
      const values = {
        legalName: c.legalName,
        addressLines: c.addressLines,
        dotNumber: c.dotNumber,
        mcNumber: c.mcNumber,
        status: "active",
      };
      const id = clientIdByExt.get(c.externalId);
      if (id) {
        await tx.update(clients).set(values).where(eq(clients.id, id));
      } else {
        const [row] = await tx
          .insert(clients)
          .values({ tenantId, source: SOURCE, externalId: c.externalId, ...values })
          .returning({ id: clients.id });
        clientIdByExt.set(c.externalId, row.id);
      }
    }
    // Clients with no certifiable policy left stay on file but stop matching.
    const liveClientExt = [...data.insureds.keys()];
    await tx
      .update(clients)
      .set({ status: "inactive" })
      .where(
        and(
          eq(clients.source, SOURCE),
          liveClientExt.length ? notInArray(clients.externalId, liveClientExt) : sql`true`
        )
      );

    // ---- policies (one CertFlow row per ACORD section) ----
    const seenPolicyExt: string[] = [];
    let coverageRows = 0;
    for (const h of data.headers) {
      const clientId = clientIdByExt.get(h.insuredExternalId);
      const covs = data.coverages.get(h.externalId) ?? [];
      if (!clientId || !covs.length) continue;
      const insurer = await insurerId(tx, h.carrierName, h.carrierNaic);

      for (const cv of covs) {
        const externalId = `${h.externalId}:${cv.section}`;
        seenPolicyExt.push(externalId);
        coverageRows++;
        const values = {
          clientId,
          insurerId: insurer,
          kind: cv.kind,
          label: cv.label,
          policyNumber: h.policyNumber,
          effDate: h.effDate,
          expDate: h.expDate,
          limits: cv.limits,
          flags: cv.flags,
          limitText: cv.limitText,
          status: "active",
        };
        const [existing] = await tx
          .select({ id: policies.id })
          .from(policies)
          .where(and(eq(policies.source, SOURCE), eq(policies.externalId, externalId)));
        if (existing) {
          // addlInsd / subrWvd / operationsNote are the agency's to set on the
          // CertFlow side; a sync does not overwrite them.
          await tx.update(policies).set(values).where(eq(policies.id, existing.id));
        } else {
          await tx.insert(policies).values({ tenantId, source: SOURCE, externalId, ...values });
        }
      }
    }
    const retired = await tx
      .update(policies)
      .set({ status: "inactive" })
      .where(
        and(
          eq(policies.source, SOURCE),
          eq(policies.status, "active"),
          seenPolicyExt.length ? notInArray(policies.externalId, seenPolicyExt) : sql`true`
        )
      )
      .returning({ id: policies.id });

    // ---- vehicles ----
    const clientByPolicy = new Map(data.headers.map((h) => [h.externalId, clientIdByExt.get(h.insuredExternalId)]));
    const seenVehicleExt: string[] = [];
    const orderByClient = new Map<string, number>();
    for (const v of data.vehicles) {
      const clientId = clientByPolicy.get(v.policyExternalId);
      if (!clientId || seenVehicleExt.includes(v.externalId)) continue;
      seenVehicleExt.push(v.externalId);
      const sortOrder = orderByClient.get(clientId) ?? 0;
      orderByClient.set(clientId, sortOrder + 1);
      const values = {
        clientId,
        year: v.year,
        make: v.make,
        model: v.model,
        vin: v.vin,
        deductibleComp: v.deductibleComp,
        deductibleColl: v.deductibleColl,
        sortOrder,
      };
      const [existing] = await tx
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(and(eq(vehicles.source, SOURCE), eq(vehicles.externalId, v.externalId)));
      if (existing) await tx.update(vehicles).set(values).where(eq(vehicles.id, existing.id));
      else await tx.insert(vehicles).values({ tenantId, source: SOURCE, externalId: v.externalId, ...values });
    }
    // Vehicles hold no history of their own (certificates snapshot them), so
    // one that left the schedule is simply removed.
    await tx
      .delete(vehicles)
      .where(
        and(eq(vehicles.source, SOURCE), seenVehicleExt.length ? notInArray(vehicles.externalId, seenVehicleExt) : sql`true`)
      );

    const stats: SyncStats = {
      policiesRead: data.policiesRead,
      policiesCertifiable: data.headers.length,
      clients: data.insureds.size,
      coverageRows,
      vehicles: seenVehicleExt.length,
      retiredPolicies: retired.length,
    };
    return stats;
  });
}

// ---------------------------------------------------------------- entry points

const inFlight = new Map<string, Promise<SyncStats>>();

/** Run one sync for one agency. Concurrent callers share the same run. */
export function syncTenant(tenantId: string, actorUserId: string | null = null): Promise<SyncStats> {
  const running = inFlight.get(tenantId);
  if (running) return running;
  const run = doSync(tenantId, actorUserId).finally(() => inFlight.delete(tenantId));
  inFlight.set(tenantId, run);
  return run;
}

async function doSync(tenantId: string, actorUserId: string | null): Promise<SyncStats> {
  const creds = await credentialsFor(tenantId);
  if (!creds) throw new NowCertsError("NowCerts is not connected for this agency.");

  try {
    const stats = await writeAll(tenantId, await fetchAll(creds));
    await withTenant(tenantId, async (tx) => {
      await tx
        .update(tenantNowcertsSettings)
        .set({ lastSyncAt: new Date(), lastSyncStatus: "ok", lastSyncError: null, lastSyncStats: stats })
        .where(eq(tenantNowcertsSettings.tenantId, tenantId));
      await audit(tx, {
        tenantId,
        actorUserId,
        action: "nowcerts.synced",
        subjectType: "tenant",
        subjectId: tenantId,
        after: stats,
      });
    });
    return stats;
  } catch (err) {
    const message = (err as Error).message.slice(0, 300);
    await withTenant(tenantId, (tx) =>
      tx
        .update(tenantNowcertsSettings)
        .set({ lastSyncAt: new Date(), lastSyncStatus: "error", lastSyncError: message })
        .where(eq(tenantNowcertsSettings.tenantId, tenantId))
    ).catch(() => {});
    throw err;
  }
}

/**
 * Called by the watcher's supervisor tick: sync every NowCerts agency whose
 * interval has elapsed. Sequential, so one large agency cannot starve the
 * database; a failure is recorded against that agency and the rest continue.
 */
export async function runDueSyncs(): Promise<void> {
  const due = await db
    .select({ tenantId: tenants.id })
    .from(tenants)
    .innerJoin(tenantNowcertsSettings, eq(tenantNowcertsSettings.tenantId, tenants.id))
    .where(
      and(
        eq(tenants.status, "active"),
        eq(tenants.dataSource, "nowcerts"),
        eq(tenantNowcertsSettings.enabled, true),
        sql`(${tenantNowcertsSettings.lastSyncAt} is null or ${tenantNowcertsSettings.lastSyncAt} < now() - make_interval(mins => ${tenantNowcertsSettings.syncIntervalMinutes}))`
      )
    );

  for (const { tenantId } of due) {
    try {
      const stats = await syncTenant(tenantId);
      console.log(`[nowcerts] ${tenantId}: ${stats.clients} clients, ${stats.coverageRows} coverage rows, ${stats.vehicles} vehicles`);
    } catch (err) {
      console.warn(`[nowcerts] ${tenantId}: ${(err as Error).message}`);
    }
  }
}

