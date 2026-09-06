/**
 * The extractor, tested on its own — no database, no network.
 *
 * `extractInsuredNames` is pure, so this runs anywhere and in milliseconds.
 * It is the fast feedback loop while tuning patterns; the database-backed
 * `npm run verify:interpretation` then proves the whole chain.
 *
 *   npm run verify:extraction
 */

import { extractInsuredNames } from "@/lib/matching/extract";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

interface Case {
  why: string;
  subject?: string;
  body?: string;
  /** Expected top result; null means "must extract nothing". */
  expect: string | null;
  /** Names that must never appear — usually the sender's own company. */
  forbid?: string[];
}

const SIGNATURE = "\n\nRegards,\nDana Whitfield\nMidwest Freight Brokers Inc";

const CASES: Case[] = [
  // ---- should extract ----
  {
    why: "subject tag with em dash",
    subject: "COI request — Smart Way Solutions Inc",
    expect: "Smart Way Solutions Inc",
  },
  {
    why: "subject tag with colon",
    subject: "Certificate of Insurance: Smart Way Solutions",
    expect: "Smart Way Solutions",
  },
  {
    why: "explicit label",
    body: "Insured: Smart Way Solutions, LLC\nHolder: Northstar Logistics",
    expect: "Smart Way Solutions, LLC",
  },
  {
    why: "named insured label",
    body: "Named Insured - Smart Way Solutions Inc",
    expect: "Smart Way Solutions Inc",
  },
  {
    why: "COI for X, mid-sentence",
    body: "Could you send a certificate of insurance for Smartway Solutions?" + SIGNATURE,
    expect: "Smartway Solutions",
    forbid: ["Midwest Freight Brokers Inc", "Midwest Freight Brokers"],
  },
  {
    why: "trailing prose is cut off",
    body: "We need a COI for Smart Way Solutions please send by Friday",
    expect: "Smart Way Solutions",
  },
  {
    why: "on behalf of",
    body: "I am writing on behalf of Smart Way Solutions Inc to request a certificate.",
    expect: "Smart Way Solutions Inc",
  },
  {
    why: "suffix after comma is kept",
    body: "Please issue a certificate for Smart Way Solutions, Inc.",
    expect: "Smart Way Solutions, Inc",
  },

  // ---- should extract nothing ----
  {
    why: "no company named",
    subject: "Certificate please",
    body: "Can you send the usual certificate over? Same as last time.",
    expect: null,
  },
  {
    why: "sender's company only — in the signature",
    subject: "Insurance paperwork",
    body: "Please send the certificate at your earliest convenience." + SIGNATURE,
    expect: null,
    forbid: ["Midwest Freight Brokers Inc", "Midwest Freight Brokers"],
  },
  {
    why: "a single word is not a company",
    body: "We need a COI for Monday.",
    expect: null,
  },
  {
    why: "empty input",
    expect: null,
  },
];

console.log("extraction:\n");

for (const c of CASES) {
  const found = extractInsuredNames({ subject: c.subject, body: c.body });
  const names = found.map((f) => f.name);
  const top = names[0] ?? null;

  const ok = c.expect === null ? found.length === 0 : top === c.expect;
  check(
    `  ${c.why.padEnd(38)} -> ${top === null ? "(nothing)" : `"${top}"`}`,
    ok,
    ok ? "" : `expected ${c.expect === null ? "(nothing)" : `"${c.expect}"`}`
  );

  for (const banned of c.forbid ?? []) {
    check(
      `    never proposes "${banned}"`,
      !names.some((n) => n.toLowerCase() === banned.toLowerCase()),
      names.join(" | ")
    );
  }
}

// The most explicit phrasing must win when several are present.
const mixed = extractInsuredNames({
  subject: "COI request — Wrong Company Ltd",
  body: "Insured: Smart Way Solutions Inc",
});
check(
  "\n  explicit label outranks a subject tag",
  mixed[0]?.name === "Smart Way Solutions Inc",
  mixed.map((m) => `${m.source}:"${m.name}"`).join(" | ")
);

console.log(failures === 0 ? "\nall extraction checks passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
