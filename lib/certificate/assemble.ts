/**
 * Deterministic certificate assembly — database rows in, ACORD 25 object out.
 *
 * THIS FILE CONTAINS NO AI, NO NETWORK CALLS, AND NO RANDOMNESS.
 *
 * That is the central safety property of the whole system. An LLM decides what
 * a requester *asked for*; this function decides what is *true*, and it does so
 * by reading the system of record and nothing else. Every policy number, limit,
 * date and NAIC code on an issued certificate traces to a database row.
 *
 * A hallucinated liability limit on an issued COI is a legal event, not a bug.
 * Keeping this function pure is what makes that structurally impossible — and
 * it means the whole thing is unit-testable without a database or an API key.
 */

import { wrapLine } from "./text";
import {
  blankCoverages,
  type Acord101Header,
  type Certificate,
  type Coverages,
  type OtherCoverage,
  type Party,
  type Producer,
} from "./types";

// ---------------------------------------------------------------- form capacity

/**
 * DESCRIPTION OF OPERATIONS box, measured off the blank template: the section
 * runs 590 -> 661.7 pt, the printed caption takes the first ~11 pt, and the
 * remainder holds five lines at the 10.6 pt leading used in lib/acordMap.js.
 *
 * These are VISUAL lines, not logical ones. A single note about towing coverage
 * is one string but occupies two lines once wrapped, and counting it as one is
 * how text ends up printed past the edge of the box.
 */
export const MAX_DESC_LINES = 5;
export const DESC_WIDTH = 562;
export const DESC_SIZE = 7;

/** Free coverage rows beneath Workers Comp on the blank ACORD 25. */
export const MAX_OTHER_ROWS = 3;

/** Insurer letters available in the INSURER(S) AFFORDING COVERAGE block. */
const INSURER_LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

// ---------------------------------------------------------------- input shapes

export interface PolicyInput {
  kind: "cgl" | "auto" | "umbrella" | "workersComp" | "cargo" | "physDamage" | "other";
  label: string | null;
  policyNumber: string;
  effDate: string; // "YYYY-MM-DD" from Postgres
  expDate: string;
  addlInsd: boolean;
  subrWvd: boolean;
  limits: Record<string, string>;
  flags: Record<string, string | boolean>;
  limitText: string | null;
  /** Free text for DESCRIPTION OF OPERATIONS — see policies.operationsNote. */
  operationsNote?: string | null;
  insurerName: string;
  insurerNaic: string | null;
}

export interface VehicleInput {
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string;
  statedValue: string | null;
  deductibleComp: string | null;
  deductibleColl: string | null;
}

export interface AssembleInput {
  producer: Producer;
  insured: Party;
  holder: Party;
  policies: PolicyInput[];
  vehicles: VehicleInput[];
  /** Free-text notes that belong in DESCRIPTION OF OPERATIONS above the fleet
   *  list — e.g. "Certificate holder is additional insured where required". */
  operationsNotes?: string[];
  /**
   * Print vehicle identification numbers in the fleet list.
   *
   * DEFAULTS TO FALSE. A VIN identifies a specific vehicle, and a full
   * schedule with VINs is an inventory of the insured's rolling stock. Most
   * requests do not need one, so the absence of a request is treated as "do
   * not include" rather than "no preference". See lib/matching/vinRequest.ts.
   */
  includeVins?: boolean;
  certificateNumber: string;
  revisionNumber?: string;
  issueDate: string; // "MM/DD/YYYY"
  authorizedRep: string;
  acordEdition: string;
}

// ---------------------------------------------------------------- helpers

/**
 * "2025-12-26" -> "12/26/2025".
 *
 * String surgery rather than `new Date()` on purpose: constructing a Date here
 * would apply the server's timezone and could render 12/25 on one machine and
 * 12/26 on another. On an insurance document, an effective date that shifts by
 * a day between preview and PDF is a real defect.
 */
export function toAcordDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${m}/${d}/${y}` : "";
}

/** 18250 -> "18,250". Values already carrying separators pass through. */
export function toAcordMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const digits = String(value).replace(/[^0-9.]/g, "");
  if (!digits) return "";
  const [whole, frac] = digits.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac && Number(frac) > 0 ? `${grouped}.${frac}` : grouped;
}

function normaliseLimits<T extends Record<string, string>>(base: T, raw: Record<string, string>): T {
  const out = { ...base };
  for (const key of Object.keys(base) as (keyof T)[]) {
    const v = raw[key as string];
    if (v) out[key] = toAcordMoney(v) as T[keyof T];
  }
  return out;
}

/**
 * "2019 HINO Conventional Type Truck  VIN: 5PV...  ($18,250)  Comp: $2,500 ..."
 *
 * The VIN is omitted unless the request asked for it — see
 * lib/matching/vinRequest.ts. Because page-one capacity is computed from
 * WRAPPED line lengths, dropping VINs genuinely shortens the lines and can
 * mean a fleet that needed an ACORD 101 now fits on one page. That follows
 * automatically; nothing downstream needs to know which mode produced it.
 */
export function vehicleLine(v: VehicleInput, includeVins = false): string {
  const head = [v.year, v.make, v.model].filter(Boolean).join(" ");
  const parts = includeVins && v.vin ? [head, `VIN: ${v.vin}`] : [head];
  if (v.statedValue) parts.push(`($${toAcordMoney(v.statedValue)})`);
  const ded: string[] = [];
  if (v.deductibleComp) ded.push(`Comp: $${toAcordMoney(v.deductibleComp)}`);
  if (v.deductibleColl) ded.push(`Coll: $${toAcordMoney(v.deductibleColl)}`);
  if (ded.length) parts.push(ded.join(", "));
  return parts.filter(Boolean).join("  ");
}

// ---------------------------------------------------------------- assembly

/**
 * Assign insurer letters A–F in order of first appearance.
 *
 * Order matters and must be stable: the letter printed in the INSR LTR column
 * of each coverage row has to agree with the INSURER(S) AFFORDING COVERAGE
 * block above it. Deriving both from one pass guarantees they cannot disagree.
 */
function assignInsurerLetters(policies: PolicyInput[]) {
  const byKey = new Map<string, { letter: string; name: string; naic: string }>();
  for (const p of policies) {
    const key = `${p.insurerName}|${p.insurerNaic ?? ""}`;
    if (byKey.has(key)) continue;
    if (byKey.size >= INSURER_LETTERS.length) break; // form has only six slots
    byKey.set(key, {
      letter: INSURER_LETTERS[byKey.size],
      name: p.insurerName,
      naic: p.insurerNaic ?? "",
    });
  }
  const letterFor = (p: PolicyInput) => byKey.get(`${p.insurerName}|${p.insurerNaic ?? ""}`)?.letter ?? "";
  return { insurers: [...byKey.values()], letterFor };
}

function applyPolicy(cov: Coverages, p: PolicyInput, letter: string, otherRows: OtherCoverage[]) {
  const eff = toAcordDate(p.effDate);
  const exp = toAcordDate(p.expDate);

  switch (p.kind) {
    case "cgl":
      cov.cgl = {
        ...cov.cgl,
        enabled: true,
        insrLtr: letter,
        addlInsd: p.addlInsd,
        subrWvd: p.subrWvd,
        form: (p.flags.form as CglForm) || "occur",
        policyNumber: p.policyNumber,
        eff,
        exp,
        aggregatePer: (p.flags.aggregatePer as AggPer) || "policy",
        limits: normaliseLimits(cov.cgl.limits, p.limits),
      };
      break;

    case "auto":
      cov.auto = {
        ...cov.auto,
        enabled: true,
        insrLtr: letter,
        addlInsd: p.addlInsd,
        subrWvd: p.subrWvd,
        scope: (p.flags.scope as AutoScope) || "any",
        policyNumber: p.policyNumber,
        eff,
        exp,
        limits: normaliseLimits(cov.auto.limits, p.limits),
      };
      break;

    case "umbrella":
      cov.umbrella = {
        ...cov.umbrella,
        enabled: true,
        insrLtr: letter,
        form: (p.flags.form as CglForm) || "occur",
        policyNumber: p.policyNumber,
        eff,
        exp,
        limits: normaliseLimits(cov.umbrella.limits, p.limits),
      };
      break;

    case "workersComp":
      cov.workersComp = {
        ...cov.workersComp,
        enabled: true,
        insrLtr: letter,
        policyNumber: p.policyNumber,
        eff,
        exp,
        perStatute: Boolean(p.flags.perStatute),
        limits: normaliseLimits(cov.workersComp.limits, p.limits),
      };
      break;

    // cargo / physDamage / other all land in the free rows below Workers Comp.
    default:
      otherRows.push({
        enabled: true,
        insrLtr: letter,
        label: p.label ?? defaultLabel(p.kind),
        policyNumber: p.policyNumber,
        eff,
        exp,
        addlInsd: p.addlInsd,
        subrWvd: p.subrWvd,
        limitText: p.limitText ?? "",
      });
  }
}

type CglForm = "occur" | "claimsMade";
type AggPer = "policy" | "project" | "loc";
type AutoScope = "any" | "owned" | "scheduled" | "hired" | "nonOwned";

function defaultLabel(kind: PolicyInput["kind"]): string {
  if (kind === "cargo") return "Motor Truck Cargo";
  if (kind === "physDamage") return "Physical Damage";
  return "";
}

/**
 * Build the certificate.
 *
 * Overflow handling: the DESCRIPTION OF OPERATIONS box holds ~5 lines. A fleet
 * of six trucks does not fit, which is exactly why the sample document carries
 * a second page. Lines beyond capacity move to `additionalRemarks` and are
 * rendered on an ACORD 101 Additional Remarks Schedule, with a pointer left on
 * page 1 so a reader knows to look for it.
 */
export function assembleCertificate(input: AssembleInput): Certificate {
  const cov = blankCoverages();
  const otherRows: OtherCoverage[] = [];

  // Stable ordering so the same data always produces byte-identical output —
  // required for the PDF hash stored at approval to be meaningful.
  const ordered = [...input.policies].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  const { insurers, letterFor } = assignInsurerLetters(ordered);

  for (const p of ordered) applyPolicy(cov, p, letterFor(p), otherRows);

  const overflowRows = otherRows.slice(MAX_OTHER_ROWS);
  cov.other = otherRows.slice(0, MAX_OTHER_ROWS);

  // ---- description of operations ----
  // Policy notes first, in print order (`ordered` is already sorted), then any
  // note supplied for this certificate alone. Collected here rather than in
  // load.ts so the ordering rule lives in exactly one place.
  const notes = [
    ...ordered.map((p) => p.operationsNote).filter((n): n is string => Boolean(n)),
    ...(input.operationsNotes ?? []),
  ].filter(Boolean);
  const vehicleLines = input.vehicles.map((v) => vehicleLine(v, input.includeVins ?? false));
  const fleet = vehicleLines.length ? ["Vehicles:", ...vehicleLines] : [];

  // Coverage rows that did not fit on the form still have to be disclosed.
  const overflowNotes = overflowRows.map(
    (r) => `${r.label}: policy ${r.policyNumber}, ${r.eff}–${r.exp}${r.limitText ? `, ${r.limitText}` : ""}`
  );

  const allLines = [...notes, ...overflowNotes, ...fleet];
  const { descLines, additionalRemarks } = fitDescription(allLines);

  return {
    date: input.issueDate,
    certificateNumber: input.certificateNumber,
    revisionNumber: input.revisionNumber ?? "",
    acordEdition: input.acordEdition,
    producer: input.producer,
    insured: input.insured,
    insurers,
    coverages: cov,
    // Already hard-wrapped to the box width. Storing the wrapped form is what
    // guarantees the overlay and the PDF break in identical places.
    descriptionOfOperations: descLines.join("\n"),
    additionalRemarks,
    acord101: additionalRemarks.length ? buildAcord101(input, ordered[0], additionalRemarks) : null,
    holder: input.holder,
    authorizedRep: input.authorizedRep,
    signatureMode: "signature",
  };
}

const SEE_ATTACHED = "See attached ACORD 101 Additional Remarks Schedule.";

/** Remarks box on the ACORD 101 (lib/acord101Map.js). */
const REMARKS_WIDTH = 566;
const REMARKS_SIZE = 7; // measured: the sample's ACORD 101 is MyriadPro-Regular 7pt, same as page 1

/**
 * Build the ACORD 101 header.
 *
 * The schedule names one policy, one carrier and one effective date. Those come
 * from the FIRST policy in print order — the primary liability policy — rather
 * than from whichever row happened to overflow, which is what a reader expects
 * when the page is detached from the certificate.
 */
function buildAcord101(
  input: AssembleInput,
  primary: PolicyInput | undefined,
  remarkLines: string[]
): Acord101Header {
  return {
    pageNumber: "2",
    pageTotal: "2",
    agency: input.producer.name,
    policyNumber: primary?.policyNumber ?? "",
    carrier: primary?.insurerName ?? "",
    naic: primary?.insurerNaic ?? "",
    namedInsured: input.insured.name,
    namedInsuredAddress: input.insured.address,
    effectiveDate: primary ? toAcordDate(primary.effDate) : "",
    formNumber: "25",
    formTitle: "CERTIFICATE OF LIABILITY INSURANCE",
    remarks: remarkLines
      .flatMap((line) => wrapLine(line, REMARKS_WIDTH, REMARKS_SIZE))
      .join("\n"),
  };
}

/**
 * Decide what fits in DESCRIPTION OF OPERATIONS and what goes to the ACORD 101.
 *
 * Splits on LOGICAL lines but budgets in VISUAL ones: a note or a vehicle moves
 * to the schedule whole, never with its tail sheared off mid-wrap. When
 * anything overflows, one line of the budget is reserved for the pointer, so a
 * reader is never left unaware that a second page exists.
 */
export function fitDescription(logicalLines: string[]): {
  descLines: string[];
  additionalRemarks: string[];
} {
  const wrap = (line: string) => wrapLine(line, DESC_WIDTH, DESC_SIZE);

  const wrapped = logicalLines.map(wrap);
  const total = wrapped.reduce((n, w) => n + w.length, 0);
  if (total <= MAX_DESC_LINES) {
    return { descLines: wrapped.flat(), additionalRemarks: [] };
  }

  const budget = MAX_DESC_LINES - wrap(SEE_ATTACHED).length;
  const descLines: string[] = [];
  let used = 0;
  let i = 0;

  for (; i < logicalLines.length; i++) {
    const lines = wrapped[i];
    if (used + lines.length > budget) break;
    descLines.push(...lines);
    used += lines.length;
  }

  descLines.push(SEE_ATTACHED);
  return { descLines, additionalRemarks: logicalLines.slice(i) };
}

/** Print order on the ACORD 25 grid, top to bottom. */
const KIND_ORDER: Record<PolicyInput["kind"], number> = {
  cgl: 0,
  auto: 1,
  umbrella: 2,
  workersComp: 3,
  cargo: 4,
  physDamage: 5,
  other: 6,
};
