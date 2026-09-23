/**
 * Loads everything the assembler needs from the database.
 *
 * Split from assemble.ts on purpose: this file talks to Postgres, that one is
 * pure. Keeping the boundary sharp means the assembly logic stays unit-testable
 * without a database, and — if the backend is ever ported to Spring Boot — only
 * this file needs rewriting.
 */

import { and, asc, eq } from "drizzle-orm";
import { withTenant, type TenantDb } from "@/lib/db/client";
import {
  certificateHolders,
  clients,
  insurers,
  policies,
  producers,
  vehicles,
} from "@/db/schema";
import { assembleCertificate, type AssembleInput, type PolicyInput } from "./assemble";
import type { Certificate } from "./types";

export interface LoadOptions {
  tenantId: string;
  clientId: string;
  holderId: string;
  certificateNumber: string;
  issueDate: string; // "MM/DD/YYYY"
  authorizedRep: string;
  acordEdition: string;
  revisionNumber?: string;
  operationsNotes?: string[];
  /** Print VINs in the fleet list. Only when the request asked. */
  includeVins?: boolean;
}

export async function loadCertificate(opts: LoadOptions): Promise<Certificate> {
  const input = await loadAssembleInput(opts);
  return assembleCertificate(input);
}

/**
 * @param tx  an already-open tenant transaction. Callers that are mid-write
 *            (lib/certificate/service.ts) must pass theirs: opening a second
 *            transaction here would take a different pooled connection and
 *            deadlock against locks the first one holds.
 */
export async function loadAssembleInput(
  opts: LoadOptions,
  tx?: TenantDb
): Promise<AssembleInput> {
  const run = async (tx: TenantDb): Promise<AssembleInput> => {
    // RLS pins every query below to this tenant. The explicit tenant filters
    // are belt and braces, and they are NOT decoration: with DB_ENFORCE_RLS
    // off, the connection user bypasses RLS, and "the default producer" then
    // meant whichever agency's row came first — one agency's letterhead on
    // another agency's certificate. Filter here as well, so the document is
    // right even when the database is not enforcing anything.
    const [client] = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.id, opts.clientId), eq(clients.tenantId, opts.tenantId)));
    if (!client) throw new Error(`Client ${opts.clientId} not found for this tenant.`);

    const [holder] = await tx
      .select()
      .from(certificateHolders)
      .where(and(eq(certificateHolders.id, opts.holderId), eq(certificateHolders.tenantId, opts.tenantId)));
    if (!holder) throw new Error(`Certificate holder ${opts.holderId} not found for this tenant.`);

    const [producer] = await tx
      .select()
      .from(producers)
      .where(and(eq(producers.tenantId, opts.tenantId), eq(producers.isDefault, true)))
      .limit(1);
    if (!producer) throw new Error("No default producer configured for this tenant.");

    const policyRows = await tx
      .select({
        kind: policies.kind,
        label: policies.label,
        policyNumber: policies.policyNumber,
        effDate: policies.effDate,
        expDate: policies.expDate,
        addlInsd: policies.addlInsd,
        subrWvd: policies.subrWvd,
        limits: policies.limits,
        flags: policies.flags,
        limitText: policies.limitText,
        operationsNote: policies.operationsNote,
        insurerName: insurers.name,
        insurerNaic: insurers.naic,
      })
      .from(policies)
      .innerJoin(insurers, eq(policies.insurerId, insurers.id))
      .where(
        and(eq(policies.tenantId, opts.tenantId), eq(policies.clientId, opts.clientId), eq(policies.status, "active"))
      );

    const vehicleRows = await tx
      .select({
        year: vehicles.year,
        make: vehicles.make,
        model: vehicles.model,
        vin: vehicles.vin,
        statedValue: vehicles.statedValue,
        deductibleComp: vehicles.deductibleComp,
        deductibleColl: vehicles.deductibleColl,
      })
      .from(vehicles)
      .where(and(eq(vehicles.tenantId, opts.tenantId), eq(vehicles.clientId, opts.clientId)))
      // Schedule order first, VIN only to break ties: reproducible output that
      // still matches how the agency lists the fleet.
      .orderBy(asc(vehicles.sortOrder), asc(vehicles.vin));

    return {
      producer: {
        name: producer.name,
        address: producer.addressLines,
        contactName: producer.contactName ?? "",
        phone: producer.phone ?? "",
        fax: producer.fax ?? "",
        email: producer.email ?? "",
      },
      insured: { name: client.legalName, address: client.addressLines },
      holder: { name: holder.name, address: holder.addressLines },
      policies: policyRows as PolicyInput[],
      vehicles: vehicleRows,
      // Per-policy notes ride on the policy rows; the assembler emits them in
      // print order. Anything here is extra, for this certificate only.
      operationsNotes: opts.operationsNotes,
      includeVins: opts.includeVins ?? false,
      certificateNumber: opts.certificateNumber,
      revisionNumber: opts.revisionNumber,
      issueDate: opts.issueDate,
      authorizedRep: opts.authorizedRep,
      acordEdition: opts.acordEdition,
    };
  };

  return tx ? run(tx) : withTenant(opts.tenantId, run);
}
