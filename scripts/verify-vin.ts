/**
 * VINs appear only when the request asked for them.
 *
 * Two things are tested here. First, that the reader gets the question right —
 * including the inversion cases, where "no VINs needed" contains the word it is
 * looking for and must NOT be read as a request. Second, that the answer
 * actually reaches the document: the same fleet is assembled both ways and the
 * output compared.
 *
 * Pure. No database, no network.
 *
 *   npm run verify:vin
 */

import { wantsVins } from "@/lib/matching/vinRequest";
import { vehicleLine, assembleCertificate, type AssembleInput } from "@/lib/certificate/assemble";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

interface Case {
  why: string;
  subject?: string;
  body?: string;
  want: boolean;
}

const CASES: Case[] = [
  // ---- must be read as asking ----
  { why: "plain request", body: "Please send a COI with VINs listed.", want: true },
  { why: "spelled out", body: "We need the vehicle identification numbers on the cert.", want: true },
  { why: "singular, punctuated", body: "Can the certificate show the V.I.N. for each unit?", want: true },
  { why: "in the subject", subject: "COI request - include VIN numbers", want: true },
  { why: "parenthesised plural", body: "Please list the VIN(s) for all power units.", want: true },
  { why: "unit numbers", body: "Please include unit numbers on the schedule.", want: true },

  // ---- must NOT be read as asking ----
  { why: "an ordinary request", body: "Please send a certificate of insurance for Smart Way Solutions.", want: false },
  { why: "nothing said at all", body: "COI please.", want: false },
  { why: "empty email", body: "", want: false },

  // ---- the inversions: these CONTAIN the word and must still be false ----
  { why: "no VINs needed", body: "Send the COI. No VINs needed.", want: false },
  { why: "without VINs", body: "A certificate without VINs is fine for our file.", want: false },
  { why: "VINs are not required", body: "VINs are not required, just the limits.", want: false },
  { why: "do not include VINs", body: "Please do not include VINs on this one.", want: false },
  { why: "omit the vehicle identification numbers", body: "Please omit the vehicle identification numbers.", want: false },

  // ---- must not fire on lookalikes ----
  { why: "'vintage' is not a VIN", body: "Our vintage fleet needs a COI.", want: false },
  { why: "a name containing the letters", body: "Please send a COI for Vinson Logistics.", want: false },
];

console.log("\nVIN disclosure — only when the requester asks\n");

for (const c of CASES) {
  const got = wantsVins({ subject: c.subject, body: c.body });
  check(
    `  ${c.want ? "includes " : "omits   "} ${c.why}`,
    got.wanted === c.want,
    got.evidence.slice(0, 62)
  );
}

// ---------------------------------------------------------------- the document

console.log("\nthe decision reaches the printed document:");

const FLEET = [
  { year: 2019, make: "HINO", model: "Conventional Type Truck", vin: "5PVNJ8JV1K4S56789", statedValue: "18250", deductibleComp: "2500", deductibleColl: "2500" },
  { year: 2021, make: "FREIGHTLINER", model: "Cascadia", vin: "3AKJHHDR1MSMB1234", statedValue: "92000", deductibleComp: "2500", deductibleColl: "2500" },
];

check(
  "  a line carries the VIN when asked",
  vehicleLine(FLEET[0], true).includes("VIN: 5PVNJ8JV1K4S56789")
);
check(
  "  a line omits the VIN when not asked",
  !vehicleLine(FLEET[0], false).includes("VIN"),
  vehicleLine(FLEET[0], false)
);
check(
  "  the vehicle is still identifiable without its VIN",
  ["2019", "HINO", "Conventional Type Truck"].every((t) => vehicleLine(FLEET[0], false).includes(t)),
  vehicleLine(FLEET[0], false)
);

function build(includeVins: boolean) {
  const input: AssembleInput = {
    producer: { name: "Whittington Agency, LLC", address: "1 Main St\nColumbus, OH 43215", contactName: "Certificate Department", phone: "614-555-0100", fax: "", email: "certificates@example.com" },
    insured: { name: "Smart Way Solutions Inc", address: "100 Fleet Rd\nColumbus, OH 43219" },
    holder: { name: "Redline Freight Brokers Inc", address: "9 Dock St\nToledo, OH 43604" },
    policies: [
      {
        kind: "auto", label: null, policyNumber: "2026256248",
        effDate: "2025-12-26", expDate: "2026-12-26",
        addlInsd: false, subrWvd: false,
        limits: { combinedSingle: "1,000,000" }, flags: { scope: "any" },
        limitText: null, operationsNote: null,
        insurerName: "National General Insurance Company", insurerNaic: "23833",
      },
    ],
    vehicles: FLEET,
    includeVins,
    certificateNumber: "COI-TEST-0001",
    issueDate: "07/16/2026",
    authorizedRep: "Test Rep",
    acordEdition: "2025/12",
  };
  return assembleCertificate(input);
}

const withVins = build(true);
const without = build(false);

check("  assembled WITH vins mentions VIN", /VIN:/.test(withVins.descriptionOfOperations));
check(
  "  assembled WITHOUT vins mentions no VIN anywhere",
  !/VIN/i.test(without.descriptionOfOperations) &&
    !/VIN/i.test(without.acord101?.remarks ?? "")
);
check(
  "  the fleet is still listed when VINs are withheld",
  /HINO/.test(without.descriptionOfOperations) && /FREIGHTLINER/.test(without.descriptionOfOperations),
  without.descriptionOfOperations.split("\n").filter(Boolean).slice(-2).join(" | ")
);
check(
  "  withholding VINs never makes the block longer",
  without.descriptionOfOperations.length < withVins.descriptionOfOperations.length
);

console.log(failures ? `\n${failures} FAILED\n` : `\nAll ${CASES.length + 7} checks passed.\n`);
process.exit(failures ? 1 : 0);
