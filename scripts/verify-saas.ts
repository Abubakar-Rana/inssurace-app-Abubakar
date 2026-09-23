/**
 * The SaaS layer's pure parts: NowCerts mapping, the SSRF guard, passwords,
 * lockout, and the cookie audience that keeps Nestnic and agency sessions apart.
 *
 * Pure. No database, no network (DNS is not touched — only IP-literal and
 * name-shape checks run here).
 *
 *   npm run verify:saas
 */

import "@/lib/env";
import { assembleCertificate } from "@/lib/certificate/assemble";
import {
  isCertifiable,
  mapCoverages,
  mapInsured,
  mapPolicyHeader,
  mapVehicle,
} from "@/lib/nowcerts/map";
import { assertPublicHost, assertPort, isPrivateAddress, IMAP_PORTS, SMTP_PORTS } from "@/lib/mail/netguard";
import {
  hashPassword,
  isLocked,
  lockoutAfterFailure,
  MAX_FAILED_LOGINS,
  passwordProblem,
  temporaryPassword,
  verifyPassword,
} from "@/lib/auth/password";

process.env.SESSION_SECRET ??= "verify-saas-secret-at-least-32-characters-long";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}
async function rejects(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, "did not throw");
  } catch {
    check(label, true);
  }
}

// ---------------------------------------------------------------- fixtures
// Shaped after the samples on https://api.nowcerts.com/Help, with PascalCase on
// the policy list (as documented there) and camelCase on coverages (as in the
// Postman collection) — the mapper must read both.

const POLICY = {
  DatabaseId: "p-1",
  Number: "2026256248",
  IsQuote: false,
  EffectiveDate: "2025-12-26T00:00:00-05:00",
  ExpirationDate: "2026-12-26T00:00:00-05:00",
  Active: true,
  Status: "Active",
  InsuredDatabaseId: "i-1",
  InsuredCommercialName: "Smart Way Solutions Inc",
  InsuredAddressLine1: "4932 Spruce Peak Rd",
  InsuredAddressLine2: "",
  InsuredCity: "Charlotte",
  InsuredState: "NC",
  InsuredZipCode: "28278",
  InsuredDOT_Number: "3121884",
  InsuredMC_Number: "MC-1084463",
  CarrierName: "National General Insurance Company",
  CarrierNAIC: "11430",
};

const COVERAGES = {
  automobileLiabilitiesCoverages: [
    { policyId: "p-1", anyAuto: false, scheduledAutos: true, limitCombinedSingle: "1000000", limitBodilyInjuryPerPerson: "" },
  ],
  cargoLiabilitiesCoverages: [{ policyId: "p-1", limit: "100000", deductible: "2500", commodities: "General freight" }],
  physicalDamageCoverages: [{ policyId: "p-1", otherCoverage: "2500", collision: "2500", type: "" }],
  generalLiabilityCoverages: [
    {
      policyId: "p-2",
      claimsMade: false,
      occur: true,
      project: true,
      limitEachOccurrence: "1,000,000",
      limitDamageToRentedPremises: "100000",
      limitMedExp: "5000",
      limitPersonalAndAdvInjury: "1000000",
      limitGeneralAggregate: "2000000",
      limitProductsCompOpAggregate: "2000000",
    },
  ],
  workerCompAndEmployersLiabilitiesCoverages: [
    { policyId: "p-3", limitWCStatLimits: true, limitEachAccident: "1000000", limitEAEmployee: "1000000", limitPolicy: "1000000" },
  ],
  // Empty rows must not print as a coverage.
  excessUmbrellaLiabilitiesCoverages: [{ policyId: "p-1", limitEachOccurrence: "", limitAggregate: "" }],
  // Sections that have no place on an ACORD 25 are ignored.
  floodPrimaryCoverages: [{ policyId: "p-1", buildingBasicLimitAmount: "500000" }],
};

async function main() {
  console.log("-- NowCerts mapping --");
  const header = mapPolicyHeader(POLICY)!;
  check("policy header maps", header?.policyNumber === "2026256248" && header.effDate === "2025-12-26" && header.expDate === "2026-12-26");
  check("carrier + NAIC carried through", header.carrierName.startsWith("National General") && header.carrierNaic === "11430");
  check("certifiable when active and in force", isCertifiable(header, "2026-09-21"));
  check("expired policy is NOT certifiable", !isCertifiable(header, "2027-01-01"));
  check("quote is NOT certifiable", !isCertifiable({ ...header, isQuote: true }, "2026-09-21"));
  check("cancelled status is NOT certifiable", !isCertifiable({ ...header, status: "Cancelled" }, "2026-09-21"));
  check("camelCase fields read too", mapPolicyHeader({ databaseId: "x", number: "N1", insuredDatabaseId: "i" })?.policyNumber === "N1");
  check("row without an id is dropped", mapPolicyHeader({ Number: "N1" }) === null);

  const insured = mapInsured(POLICY)!;
  check("insured name", insured.legalName === "Smart Way Solutions Inc");
  check("address lines built", insured.addressLines === "4932 Spruce Peak Rd\nCharlotte, NC 28278", JSON.stringify(insured.addressLines));
  check("DOT kept as digits", insured.dotNumber === "3121884");
  check("MC stripped of prefix", insured.mcNumber === "1084463");
  check(
    "individual insured falls back to first + last",
    mapInsured({ InsuredDatabaseId: "i", InsuredFirstName: "Ann", InsuredLastName: "Lee" })?.legalName === "Ann Lee"
  );

  const cov = mapCoverages(COVERAGES);
  const p1 = cov.get("p-1") ?? [];
  const auto = p1.find((c) => c.kind === "auto");
  check("auto liability row", auto?.limits.combinedSingle === "1000000" && auto.flags.scope === "scheduled");
  check("cargo becomes a free row", p1.find((c) => c.kind === "cargo")?.limitText === "Limit: $100,000, Deductible: $2,500");
  check("physical damage deductibles", p1.find((c) => c.kind === "physDamage")?.limitText === "Deductibles - Comp: $2,500, Coll: $2,500");
  check("empty umbrella is NOT a coverage", !p1.some((c) => c.kind === "umbrella"));
  check("flood (not ACORD 25) is ignored", p1.length === 3, `got ${p1.length} rows`);
  const gl = cov.get("p-2")?.[0];
  check("GL limits, separators stripped", gl?.kind === "cgl" && gl.limits.eachOccurrence === "1000000" && gl.limits.generalAggregate === "2000000");
  check("GL per-project aggregate", gl?.flags.aggregatePer === "project" && gl.flags.form === "occur");
  const wc = cov.get("p-3")?.[0];
  check("workers comp per statute", wc?.kind === "workersComp" && wc.flags.perStatute === true && wc.limits.diseasePolicy === "1000000");
  check("sections are unique per policy", new Set(p1.map((c) => c.section)).size === p1.length);
  check("junk response maps to nothing", mapCoverages(null).size === 0 && mapCoverages("x").size === 0);

  const v = mapVehicle(
    {
      databaseId: "v-1",
      vin: "3alacwfc1ldlw9109",
      year: 2020,
      make: "FRHT",
      model: "M2 106",
      policyDatabaseId: "p-1",
      vehicleSpecificCoverages: [
        { name: "Comprehensive", deductibles: [1000] },
        { name: "Collision", deductibles: [1500] },
      ],
    },
    ""
  );
  check("vehicle maps, VIN upper-cased", v?.vin === "3ALACWFC1LDLW9109" && v.year === 2020);
  check("vehicle deductibles read", v?.deductibleComp === "1000" && v.deductibleColl === "1500");
  check("vehicle without VIN is dropped", mapVehicle({ databaseId: "v" }, "p") === null);

  // End to end through the existing, unchanged assembler.
  const cert = assembleCertificate({
    producer: { name: "Agency", address: "1 Main St\nCity, ST 00000", contactName: "", phone: "", fax: "", email: "" },
    insured: { name: insured.legalName, address: insured.addressLines },
    holder: { name: "Holder Inc", address: "2 Main St" },
    policies: p1.map((c) => ({
      kind: c.kind,
      label: c.label,
      policyNumber: header.policyNumber,
      effDate: header.effDate,
      expDate: header.expDate,
      addlInsd: false,
      subrWvd: false,
      limits: c.limits,
      flags: c.flags,
      limitText: c.limitText,
      insurerName: header.carrierName,
      insurerNaic: header.carrierNaic,
    })),
    vehicles: [],
    certificateNumber: "COI-TEST-0001",
    issueDate: "09/21/2026",
    authorizedRep: "Test",
    acordEdition: "2016/03",
  });
  check("assembled: auto enabled with CSL", cert.coverages.auto.enabled && cert.coverages.auto.limits.combinedSingle === "1,000,000");
  check("assembled: two free rows (cargo + phys damage)", cert.coverages.other.length === 2);
  check("assembled: insurer A carries the NAIC", cert.insurers[0]?.naic === "11430");

  console.log("\n-- SSRF guard --");
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
    check(`private address refused: ${ip}`, isPrivateAddress(ip));
  }
  for (const ip of ["8.8.8.8", "142.250.4.108", "2607:f8b0:4004:c1b::6c"]) {
    check(`public address allowed: ${ip}`, !isPrivateAddress(ip));
  }
  await rejects("IP literal as host refused", () => assertPublicHost("127.0.0.1"));
  await rejects("bare 'localhost' refused", () => assertPublicHost("localhost"));
  await rejects("URL instead of host refused", () => assertPublicHost("http://imap.gmail.com"));
  let portOk = true;
  try {
    assertPort(143, IMAP_PORTS, "IMAP");
    portOk = false;
  } catch {}
  check("plain-text IMAP port 143 refused", portOk);
  let smtpOk = true;
  try {
    assertPort(25, SMTP_PORTS, "SMTP");
    smtpOk = false;
  } catch {}
  check("plain SMTP port 25 refused", smtpOk);

  console.log("\n-- passwords --");
  const hash = await hashPassword("Correct horse 42");
  check("hash is not the password", !hash.includes("Correct horse"));
  check("right password verifies", await verifyPassword("Correct horse 42", hash));
  check("wrong password fails", !(await verifyPassword("Correct horse 43", hash)));
  check("same password hashes differently (salted)", (await hashPassword("Correct horse 42")) !== hash);
  check("malformed hash never verifies", !(await verifyPassword("x", "garbage")) && !(await verifyPassword("x", null)));
  check("short password refused", passwordProblem("abc123") !== null);
  check("letters-only refused", passwordProblem("abcdefghijkl") !== null);
  check("contains email name refused", passwordProblem("hasnain12345", "hasnain@agency.com") !== null);
  check("decent password accepted", passwordProblem("Tractor-trailer 2026") === null);
  const temp = temporaryPassword();
  check("temporary password passes its own rules", passwordProblem(temp) === null, temp.replace(/./g, "*"));
  check("temporary passwords differ", temporaryPassword() !== temporaryPassword());

  let state = { failedLogins: 0, lockedUntil: null as Date | null };
  for (let i = 0; i < MAX_FAILED_LOGINS - 1; i++) state = lockoutAfterFailure(state.failedLogins);
  check("not locked before the limit", !isLocked(state.lockedUntil));
  state = lockoutAfterFailure(state.failedLogins);
  check(`locked after ${MAX_FAILED_LOGINS} failures`, isLocked(state.lockedUntil));

  console.log("\n-- session cookie audiences --");
  const { serializeSession, parseSession, newClaims } = await import("@/lib/auth/cookie");
  const { platformClaims } = await import("@/lib/auth/platform");
  const agencyCookie = await serializeSession(newClaims("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"));
  check("agency cookie parses as agency", Boolean(await parseSession(agencyCookie)));
  check("agency cookie REFUSED as platform", (await parseSession(agencyCookie, "platform")) === null);
  const platformCookie = await serializeSession(platformClaims("00000000-0000-0000-0000-000000000003"));
  check("platform cookie parses as platform", Boolean(await parseSession(platformCookie, "platform")));
  check("platform cookie REFUSED as agency", (await parseSession(platformCookie)) === null);
  const tampered = agencyCookie.slice(0, -2) + (agencyCookie.endsWith("A") ? "BB" : "AA");
  check("tampered cookie refused", (await parseSession(tampered)) === null);

  console.log(failures ? `\n${failures} check(s) FAILED.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
