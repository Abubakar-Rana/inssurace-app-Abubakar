/**
 * The holder reader, tested on its own — no database, no network.
 *
 * This is the one field on the certificate that comes from the email rather
 * than the agency's records, so it gets its own suite. The cases that matter
 * most are the ones where the signature is messy: phone numbers, disclaimers,
 * quoted replies, and mail with no signature at all.
 *
 *   npm run verify:holder
 */

import { extractHolder } from "@/lib/matching/holder";
import { extractInsuredNames } from "@/lib/matching/extract";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

interface Case {
  why: string;
  body?: string;
  fromAddr?: string;
  fromName?: string;
  name: string;
  address: string;
  source: "signature" | "sender";
}

const CASES: Case[] = [
  {
    why: "the ordinary case",
    body: [
      "Good afternoon,",
      "",
      "We're onboarding a new carrier and need a certificate of insurance",
      "for Smartway Solutions before we can release the first load.",
      "",
      "Regards,",
      "Dana Whitfield",
      "Carrier Compliance",
      "Redline Freight Brokers Inc",
    ].join("\n"),
    fromAddr: "dana@redlinefreight.test-real.com",
    fromName: "Dana Whitfield",
    name: "Dana Whitfield",
    address: "Carrier Compliance\nRedline Freight Brokers Inc",
    source: "signature",
  },
  {
    why: "phone and email lines are dropped — the box is a postal address",
    body: [
      "Please send a COI for Smart Way Solutions.",
      "",
      "Thanks,",
      "Maria Vasquez",
      "Northstar Logistics LLC",
      "400 Industrial Pkwy",
      "T: (555) 010-2233",
      "maria@northstar.test-real.com",
    ].join("\n"),
    fromAddr: "maria@northstar.test-real.com",
    name: "Maria Vasquez",
    address: "Northstar Logistics LLC\n400 Industrial Pkwy",
    source: "signature",
  },
  {
    why: "a mid-body 'thanks' does not win over the real sign-off",
    body: [
      "Hi — thanks for the quick turnaround last week.",
      "",
      "Thanks again for sorting the last one out. We need a COI for",
      "Smart Way Solutions Inc this time.",
      "",
      "Best regards,",
      "Tom Reilly",
      "Blue Ridge Shippers",
    ].join("\n"),
    fromAddr: "tom@blueridge.test-real.com",
    name: "Tom Reilly",
    address: "Blue Ridge Shippers",
    source: "signature",
  },
  {
    why: "a legal disclaimer ends the block",
    body: [
      "Certificate of insurance for Smart Way Solutions please.",
      "",
      "Regards,",
      "Priya Nair",
      "Cascade Freight Co",
      "",
      "CONFIDENTIALITY NOTICE: This email and any attachments are confidential",
      "and intended solely for the addressee.",
    ].join("\n"),
    fromAddr: "priya@cascade.test-real.com",
    name: "Priya Nair",
    address: "Cascade Freight Co",
    source: "signature",
  },
  {
    why: "a quoted reply chain ends the block",
    body: [
      "Resending — did this go through?",
      "",
      "Thanks,",
      "Alex Doyle",
      "Doyle Transport Group",
      "",
      "On Mon, Aug 10, 2026 at 9:14 AM Certs <certs@agency.test-real.com> wrote:",
      "> We received your request.",
    ].join("\n"),
    fromAddr: "alex@doyletransport.test-real.com",
    name: "Alex Doyle",
    address: "Doyle Transport Group",
    source: "signature",
  },
  {
    why: "a mobile footer is not a signature",
    body: ["Need a COI for Smart Way Solutions.", "", "Sent from my iPhone"].join("\n"),
    fromAddr: "jordan@lakeside.test-real.com",
    fromName: "Jordan Ellis",
    name: "Jordan Ellis",
    address: "jordan@lakeside.test-real.com",
    source: "sender",
  },
  {
    why: "no sign-off at all falls back to the sender",
    body: "Please send the certificate of insurance for Smart Way Solutions.",
    fromAddr: "ops@harborlane.test-real.com",
    fromName: "Harbor Lane Logistics",
    name: "Harbor Lane Logistics",
    address: "ops@harborlane.test-real.com",
    source: "sender",
  },
  {
    why: "no display name either — the address alone identifies them",
    body: "COI for Smart Way Solutions, please.",
    fromAddr: "dispatch@ridgeway.test-real.com",
    name: "dispatch@ridgeway.test-real.com",
    address: "",
    source: "sender",
  },
];

console.log("\nCertificate holder, read from the requester's email\n");

for (const c of CASES) {
  const got = extractHolder({ body: c.body, fromAddr: c.fromAddr, fromName: c.fromName });
  check(`  ${c.why}`, got.name === c.name && got.addressLines === c.address && got.source === c.source,
    got.name === c.name && got.addressLines === c.address
      ? got.source
      : `got ${JSON.stringify([got.name, got.addressLines])}`);
}

// ---- the invariant that makes this safe ----
//
// The holder is read from the signature and the insured from everything above
// it. If those regions ever overlapped, a requester's own company could be
// resolved as the insured — printing coverage that belongs to someone else.
console.log("\nthe two readers must not see the same text:");

const OVERLAP = [
  "We need a certificate of insurance for Smart Way Solutions Inc.",
  "",
  "Regards,",
  "Dana Whitfield",
  "Redline Freight Brokers Inc",
].join("\n");

const insureds = extractInsuredNames({ subject: "COI request", body: OVERLAP });
const holder = extractHolder({ body: OVERLAP, fromAddr: "dana@redline.test-real.com" });

check(
  "  the insured comes from above the sign-off",
  insureds.some((e) => e.name.startsWith("Smart Way Solutions")),
  insureds.map((e) => e.name).join(" | ") || "nothing"
);
check(
  "  the requester's own company is never offered as the insured",
  !insureds.some((e) => /redline/i.test(e.name)),
  insureds.map((e) => e.name).join(" | ") || "nothing"
);
check(
  "  the holder comes from below it",
  holder.addressLines.includes("Redline Freight Brokers Inc"),
  `${holder.name} / ${holder.addressLines.replace(/\n/g, " · ")}`
);
check(
  "  the insured is never offered as the holder",
  !/smart way/i.test(holder.name + holder.addressLines)
);

console.log(failures ? `\n${failures} FAILED\n` : `\nAll ${CASES.length + 4} checks passed.\n`);
process.exit(failures ? 1 : 0);
