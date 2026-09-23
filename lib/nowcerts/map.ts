/**
 * NowCerts records -> CertFlow rows. PURE: no network, no database.
 *
 * One NowCerts policy can carry several ACORD 25 rows (a commercial auto
 * policy with auto liability + motor truck cargo + physical damage), so a
 * policy maps to a LIST of CertFlow policy rows, each keyed
 * `<nowcertsPolicyId>:<section>` for idempotent upserts.
 *
 * Only values NowCerts actually holds are copied. Nothing is inferred or
 * defaulted into a limit: an empty limit stays empty and prints empty, which a
 * reviewer notices, rather than a plausible number nobody entered.
 */

import { toAcordMoney } from "@/lib/certificate/assemble";
import { pick, text } from "./client";

type Row = Record<string, unknown>;
export type Kind = "cgl" | "auto" | "umbrella" | "workersComp" | "cargo" | "physDamage" | "other";

export interface MappedClient {
  externalId: string;
  legalName: string;
  addressLines: string;
  dotNumber: string | null;
  mcNumber: string | null;
}

export interface MappedPolicyHeader {
  externalId: string;
  insuredExternalId: string;
  policyNumber: string;
  effDate: string; // YYYY-MM-DD
  expDate: string;
  carrierName: string;
  carrierNaic: string | null;
  isQuote: boolean;
  active: boolean;
  status: string;
}

export interface MappedCoverage {
  /** Unique within the policy — joined to the policy id for externalId. */
  section: string;
  kind: Kind;
  label: string | null;
  limits: Record<string, string>;
  flags: Record<string, string | boolean>;
  limitText: string | null;
}

export interface MappedVehicle {
  externalId: string;
  policyExternalId: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string;
  deductibleComp: string | null;
  deductibleColl: string | null;
}

// ---------------------------------------------------------------- helpers

export function isoDate(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

function truthy(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

/** Keep digits/decimal only; "" when nothing numeric was entered. */
function money(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /\d/.test(s) ? s.replace(/[^0-9.]/g, "") : "";
}

function dollars(v: unknown): string {
  const m = money(v);
  return m ? `$${toAcordMoney(m)}` : "";
}

function limitDeductible(limit: unknown, deductible: unknown): string {
  return [dollars(limit) && `Limit: ${dollars(limit)}`, dollars(deductible) && `Deductible: ${dollars(deductible)}`]
    .filter(Boolean)
    .join(", ");
}

function nonEmpty(obj: Record<string, string>): boolean {
  return Object.values(obj).some(Boolean);
}

// ---------------------------------------------------------------- policies + insureds

/** A PolicyDetailList row carries both the policy and its insured. */
export function mapPolicyHeader(r: Row): MappedPolicyHeader | null {
  const externalId = text(r, "DatabaseId", "Id");
  const insuredExternalId = text(r, "InsuredDatabaseId");
  const policyNumber = text(r, "Number");
  if (!externalId || !insuredExternalId || !policyNumber) return null;
  return {
    externalId,
    insuredExternalId,
    policyNumber,
    effDate: isoDate(pick(r, "EffectiveDate")),
    expDate: isoDate(pick(r, "ExpirationDate")),
    carrierName: text(r, "CarrierName") || text(r, "MgaName"),
    carrierNaic: text(r, "CarrierNAIC") || null,
    isQuote: truthy(pick(r, "IsQuote")),
    active: pick(r, "Active") === undefined ? true : truthy(pick(r, "Active")),
    status: text(r, "Status"),
  };
}

/**
 * Should this policy appear on certificates at all? Quotes, cancelled and
 * expired policies never do — printing one would certify coverage that does
 * not exist.
 */
export function isCertifiable(p: MappedPolicyHeader, todayIso: string): boolean {
  if (p.isQuote || !p.active) return false;
  if (/cancel|expired|void|declin|lapse/i.test(p.status)) return false;
  if (!p.effDate || !p.expDate) return false;
  return p.expDate >= todayIso;
}

export function mapInsured(r: Row): MappedClient | null {
  const externalId = text(r, "InsuredDatabaseId");
  const legalName =
    text(r, "InsuredCommercialName") ||
    [text(r, "InsuredFirstName"), text(r, "InsuredLastName")].filter(Boolean).join(" ");
  if (!externalId || !legalName) return null;

  const cityLine = [
    text(r, "InsuredCity"),
    [text(r, "InsuredState"), text(r, "InsuredZipCode")].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  const addressLines = [text(r, "InsuredAddressLine1"), text(r, "InsuredAddressLine2"), cityLine]
    .filter(Boolean)
    .join("\n");

  const digits = (v: string) => v.replace(/\D/g, "") || null;
  return {
    externalId,
    legalName,
    addressLines,
    dotNumber: digits(text(r, "InsuredDOT_Number")),
    mcNumber: digits(text(r, "InsuredMC_Number")),
  };
}

// ---------------------------------------------------------------- coverages

type CoverageMapper = (c: Row) => Omit<MappedCoverage, "section"> | null;

function autoScope(c: Row): string {
  if (truthy(pick(c, "anyAuto"))) return "any";
  if (truthy(pick(c, "allOwnedAutos"))) return "owned";
  if (truthy(pick(c, "scheduledAutos"))) return "scheduled";
  if (truthy(pick(c, "hiredAutos"))) return "hired";
  if (truthy(pick(c, "nonOwnedAutos"))) return "nonOwned";
  return "any";
}

function freeRow(kind: Kind, label: string, limitText: string): Omit<MappedCoverage, "section"> | null {
  return limitText ? { kind, label, limits: {}, flags: {}, limitText } : null;
}

/**
 * Coverage collection name (from GET Policy/Coverages) -> how to read it.
 * Sections NowCerts has that do not belong on an ACORD 25 (property, flood,
 * crime, life/health, personal lines) are deliberately absent.
 */
const MAPPERS: Record<string, CoverageMapper> = {
  generalLiabilityCoverages: (c) => {
    const limits = {
      eachOccurrence: money(pick(c, "limitEachOccurrence")),
      damageToRented: money(pick(c, "limitDamageToRentedPremises")),
      medExp: money(pick(c, "limitMedExp")),
      personalAdvInjury: money(pick(c, "limitPersonalAndAdvInjury")),
      generalAggregate: money(pick(c, "limitGeneralAggregate")),
      productsCompOp: money(pick(c, "limitProductsCompOpAggregate")),
    };
    if (!nonEmpty(limits)) return null;
    return {
      kind: "cgl",
      label: null,
      limits,
      flags: {
        form: truthy(pick(c, "claimsMade")) ? "claimsMade" : "occur",
        aggregatePer: truthy(pick(c, "project")) ? "project" : truthy(pick(c, "loc")) ? "loc" : "policy",
      },
      limitText: null,
    };
  },

  automobileLiabilitiesCoverages: (c) => {
    const limits = {
      combinedSingle: money(pick(c, "limitCombinedSingle")),
      biPerson: money(pick(c, "limitBodilyInjuryPerPerson")),
      biAccident: money(pick(c, "limitBodilyInjuryPerAccident")),
      propertyDamage: money(pick(c, "limitPropertyDamage")),
    };
    if (!nonEmpty(limits)) return null;
    return { kind: "auto", label: null, limits, flags: { scope: autoScope(c) }, limitText: null };
  },

  excessUmbrellaLiabilitiesCoverages: (c) => {
    const limits = {
      eachOccurrence: money(pick(c, "limitEachOccurrence")),
      aggregate: money(pick(c, "limitAggregate")),
    };
    if (!nonEmpty(limits)) return null;
    return {
      kind: "umbrella",
      label: null,
      limits,
      flags: { form: truthy(pick(c, "claimsMade")) ? "claimsMade" : "occur" },
      limitText: null,
    };
  },

  workerCompAndEmployersLiabilitiesCoverages: (c) => {
    const limits = {
      eachAccident: money(pick(c, "limitEachAccident")),
      diseaseEmployee: money(pick(c, "limitEAEmployee")),
      diseasePolicy: money(pick(c, "limitPolicy")),
    };
    const perStatute = truthy(pick(c, "limitWCStatLimits"));
    if (!nonEmpty(limits) && !perStatute) return null;
    return { kind: "workersComp", label: null, limits, flags: { perStatute }, limitText: null };
  },

  cargoLiabilitiesCoverages: (c) =>
    freeRow("cargo", "Motor Truck Cargo", limitDeductible(pick(c, "limit"), pick(c, "deductible"))),

  physicalDamageCoverages: (c) => {
    const parts = [
      dollars(pick(c, "otherCoverage")) && `Comp: ${dollars(pick(c, "otherCoverage"))}`,
      dollars(pick(c, "collision")) && `Coll: ${dollars(pick(c, "collision"))}`,
    ].filter(Boolean);
    return freeRow("physDamage", "Physical Damage", parts.length ? `Deductibles - ${parts.join(", ")}` : "");
  },

  trailerInterchangeLiabilitiesCoverages: (c) =>
    freeRow("other", "Trailer Interchange", limitDeductible(pick(c, "limit"), pick(c, "deductible"))),
  reeferBreakdownLiabilitiesCoverages: (c) =>
    freeRow("other", "Reefer Breakdown", limitDeductible(pick(c, "limit"), pick(c, "deductible"))),
  contigentCargoLiabilitiesCoverages: (c) =>
    freeRow("other", "Contingent Cargo", limitDeductible(pick(c, "limit"), pick(c, "deductible"))),
  contingentAutoLiabilitiesCoverages: (c) =>
    freeRow("other", "Contingent Auto Liability", limitDeductible(pick(c, "limit"), pick(c, "deductible"))),
  occupationalAccidentsCoverages: (c) =>
    freeRow("other", "Occupational Accident", limitDeductible(pick(c, "limit"), pick(c, "deductible"))),

  otherCoverages: (c) => freeRow("other", text(c, "description") || "Other", dollars(pick(c, "limit")) || text(c, "limit")),
  other2Coverages: (c) => freeRow("other", text(c, "description") || "Other", dollars(pick(c, "limit")) || text(c, "limit")),
  other3Coverages: (c) => freeRow("other", text(c, "description") || "Other", dollars(pick(c, "limit")) || text(c, "limit")),
  other4Coverages: (c) => freeRow("other", text(c, "description") || "Other", dollars(pick(c, "limit")) || text(c, "limit")),
};

/** GET Policy/Coverages response -> coverage rows grouped by NowCerts policy id. */
export function mapCoverages(response: unknown): Map<string, MappedCoverage[]> {
  const out = new Map<string, MappedCoverage[]>();
  if (!response || typeof response !== "object") return out;

  for (const [collection, mapper] of Object.entries(MAPPERS)) {
    const list = pick(response as Row, collection);
    if (!Array.isArray(list)) continue;
    for (const item of list as Row[]) {
      const policyId = text(item, "policyId");
      const mapped = policyId ? mapper(item) : null;
      if (!mapped) continue;
      const existing = out.get(policyId) ?? [];
      // One row per collection per policy; a second of the same section gets a suffix.
      const base = collection.replace(/Coverages$/, "");
      const same = existing.filter((e) => e.section.split("#")[0] === base).length;
      existing.push({ ...mapped, section: same ? `${base}#${same + 1}` : base });
      out.set(policyId, existing);
    }
  }
  return out;
}

// ---------------------------------------------------------------- vehicles

function deductibleFrom(coverages: unknown, pattern: RegExp): string | null {
  if (!Array.isArray(coverages)) return null;
  for (const cov of coverages as Row[]) {
    if (!pattern.test(text(cov, "name"))) continue;
    const list = pick(cov, "deductibles");
    const first = Array.isArray(list) && list.length ? list[0] : null;
    const value = money(first ?? pick(cov, "deductiblesFormatted"));
    if (value && Number(value) > 0) return value;
  }
  return null;
}

export function mapVehicle(r: Row, policyExternalId: string): MappedVehicle | null {
  const vin = text(r, "vin").toUpperCase();
  const externalId = text(r, "databaseId", "id");
  if (!vin || !externalId) return null;
  const year = Number(pick(r, "year"));
  const specific = pick(r, "vehicleSpecificCoverages");
  return {
    externalId,
    policyExternalId: text(r, "policyDatabaseId") || policyExternalId,
    year: Number.isInteger(year) && year > 1900 && year < 2100 ? year : null,
    make: text(r, "make") || null,
    model: text(r, "model") || null,
    vin,
    deductibleComp: deductibleFrom(specific, /comp|other than collision|otc/i),
    deductibleColl: deductibleFrom(specific, /coll/i),
  };
}
