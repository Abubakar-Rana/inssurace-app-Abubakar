/**
 * The certificate object — what gets rendered onto the ACORD 25 and frozen into
 * `certificates.snapshot` at approval.
 *
 * CONVENTIONS INHERITED FROM THE PROTOTYPE (keep them):
 *   - Every value is a pre-formatted STRING. Dates are "MM/DD/YYYY", money is
 *     "1,000,000". Nothing is parsed or localised at render time, which is what
 *     keeps server and client output byte-identical.
 *   - Empty means "", never null. Renderers skip empty strings.
 *
 * CHANGED FROM THE PROTOTYPE:
 *   `coverages.other` is now an ARRAY. The prototype modelled it as a single
 *   object, but real trucking certificates carry several free rows at once —
 *   the sample document has Motor Truck Cargo AND Physical Damage on one form.
 */

export interface Party {
  name: string;
  address: string;
}

export interface Producer extends Party {
  contactName: string;
  phone: string;
  fax: string;
  email: string;
}

export interface InsurerRow {
  letter: string; // A–F
  name: string;
  naic: string;
}

export interface CglCoverage {
  enabled: boolean;
  insrLtr: string;
  addlInsd: boolean;
  subrWvd: boolean;
  form: "occur" | "claimsMade" | "";
  policyNumber: string;
  eff: string;
  exp: string;
  aggregatePer: "policy" | "project" | "loc" | "";
  limits: {
    eachOccurrence: string;
    damageToRented: string;
    medExp: string;
    personalAdvInjury: string;
    generalAggregate: string;
    productsCompOp: string;
  };
}

export interface AutoCoverage {
  enabled: boolean;
  insrLtr: string;
  addlInsd: boolean;
  subrWvd: boolean;
  scope: "any" | "owned" | "scheduled" | "hired" | "nonOwned" | "";
  policyNumber: string;
  eff: string;
  exp: string;
  limits: {
    combinedSingle: string;
    biPerson: string;
    biAccident: string;
    propertyDamage: string;
  };
}

export interface UmbrellaCoverage {
  enabled: boolean;
  insrLtr: string;
  form: "occur" | "claimsMade" | "";
  policyNumber: string;
  eff: string;
  exp: string;
  limits: { eachOccurrence: string; aggregate: string };
}

export interface WorkersCompCoverage {
  enabled: boolean;
  insrLtr: string;
  policyNumber: string;
  eff: string;
  exp: string;
  perStatute: boolean;
  limits: { eachAccident: string; diseaseEmployee: string; diseasePolicy: string };
}

/** One of the free rows beneath Workers Comp — Motor Truck Cargo, Physical
 *  Damage, Trailer Interchange, Reefer Breakdown. */
export interface OtherCoverage {
  enabled: boolean;
  insrLtr: string;
  label: string;
  policyNumber: string;
  eff: string;
  exp: string;
  addlInsd: boolean;
  subrWvd: boolean;
  limitText: string;
}

export interface Coverages {
  cgl: CglCoverage;
  auto: AutoCoverage;
  umbrella: UmbrellaCoverage;
  workersComp: WorkersCompCoverage;
  other: OtherCoverage[];
}

/**
 * Header of the ACORD 101 Additional Remarks Schedule.
 *
 * The 101 repeats identifying details so the page stands on its own if it is
 * ever separated from the certificate. Computed by the assembler rather than by
 * the renderer, so the two pages cannot end up describing different policies.
 */
export interface Acord101Header {
  pageNumber: string;
  pageTotal: string;
  agency: string;
  policyNumber: string;
  carrier: string;
  naic: string;
  namedInsured: string;
  namedInsuredAddress: string;
  effectiveDate: string;
  formNumber: string;
  formTitle: string;
  /** Pre-wrapped to the remarks box width, same as descriptionOfOperations. */
  remarks: string;
}

export interface Certificate {
  date: string;
  certificateNumber: string;
  revisionNumber: string;
  acordEdition: string;
  producer: Producer;
  insured: Party;
  insurers: InsurerRow[];
  coverages: Coverages;
  descriptionOfOperations: string;
  /** Lines that did not fit on page 1 and belong on an ACORD 101. Empty when
   *  the fleet is small enough — most single-truck operators never need one. */
  additionalRemarks: string[];
  /** Present only when `additionalRemarks` is non-empty. */
  acord101: Acord101Header | null;
  holder: Party;
  authorizedRep: string;
  signatureMode: "signature" | "wet";
}

export const EMPTY_LIMITS = {
  eachOccurrence: "",
  damageToRented: "",
  medExp: "",
  personalAdvInjury: "",
  generalAggregate: "",
  productsCompOp: "",
};

export function blankCoverages(): Coverages {
  return {
    cgl: {
      enabled: false,
      insrLtr: "",
      addlInsd: false,
      subrWvd: false,
      form: "occur",
      policyNumber: "",
      eff: "",
      exp: "",
      aggregatePer: "policy",
      limits: { ...EMPTY_LIMITS },
    },
    auto: {
      enabled: false,
      insrLtr: "",
      addlInsd: false,
      subrWvd: false,
      scope: "any",
      policyNumber: "",
      eff: "",
      exp: "",
      limits: { combinedSingle: "", biPerson: "", biAccident: "", propertyDamage: "" },
    },
    umbrella: {
      enabled: false,
      insrLtr: "",
      form: "occur",
      policyNumber: "",
      eff: "",
      exp: "",
      limits: { eachOccurrence: "", aggregate: "" },
    },
    workersComp: {
      enabled: false,
      insrLtr: "",
      policyNumber: "",
      eff: "",
      exp: "",
      perStatute: false,
      limits: { eachAccident: "", diseaseEmployee: "", diseasePolicy: "" },
    },
    other: [],
  };
}
