/**
 * The mailbox filter, tested on its own — no database, no network.
 *
 * `classifyEmail` decides what reaches the dashboard, so a regression here is
 * either a dropped customer request or somebody's newsletter in the work queue.
 * Half these cases assert refusal, which is the half that matters.
 *
 *   npm run verify:classify
 */

import { classifyEmail } from "@/lib/gmail/classify";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

interface Case {
  why: string;
  subject?: string;
  body?: string;
  fromAddr?: string;
  expect: boolean;
}

const SIGNATURE = "\n\nRegards,\nDana Whitfield\nRedline Freight Brokers Inc";

const CASES: Case[] = [
  // ---- must be admitted ----
  {
    why: "explicit subject tag",
    subject: "COI request — Smart Way Solutions Inc",
    body: "Please send at your convenience." + SIGNATURE,
    fromAddr: "dana@redlinefreight.test-real.com",
    expect: true,
  },
  {
    why: "names the document in the body only",
    subject: "Insurance paperwork for new carrier",
    body:
      "We're onboarding a new carrier and need a certificate of insurance for\n" +
      "Smartway Solutions before we can release the first load." +
      SIGNATURE,
    fromAddr: "dana@redlinefreight.test-real.com",
    expect: true,
  },
  {
    why: "asks by form number",
    subject: "ACORD 25 needed",
    body: "Can you get us an ACORD 25 for the fleet this week?",
    fromAddr: "ops@northstar.test-real.com",
    expect: true,
  },
  {
    why: "labelled insured, no COI wording",
    subject: "Paperwork",
    body: "Insured: Smart Way Solutions LLC\nPlease list us as certificate holder.",
    fromAddr: "compliance@northstar.test-real.com",
    expect: true,
  },
  {
    why: "renewal request phrased as 'updated cert'",
    subject: "Updated cert",
    body: "Our copy of the certificate of insurance expired last month — could you send a current one?",
    fromAddr: "ap@shipper.test-real.com",
    expect: true,
  },
  {
    why: "misspelled but unambiguous",
    subject: "Certificate of Liability Insurance",
    body: "requesting for our files",
    fromAddr: "someone@carrier.test-real.com",
    expect: true,
  },

  // ---- must be refused ----
  {
    why: "no-reply sender cannot receive the reply",
    subject: "Your certificate of insurance is ready",
    body: "Log in to download your certificate of insurance.",
    fromAddr: "no-reply@someportal.com",
    expect: false,
  },
  {
    why: "automated security alert",
    subject: "Security alert",
    body: "A new sign-in to your Google Account.",
    fromAddr: "accounts@google.com",
    expect: false,
  },
  {
    why: "out-of-office bouncing our own subject back",
    subject: "Automatic reply: COI request — Smart Way Solutions",
    body: "I am out of the office until Monday.",
    fromAddr: "dana@redlinefreight.test-real.com",
    expect: false,
  },
  {
    why: "ordinary business mail",
    subject: "Lunch Thursday?",
    body: "Are you free around 12:30?",
    fromAddr: "colleague@agency.test-real.com",
    expect: false,
  },
  {
    why: "receipt",
    subject: "Your receipt from Acme Fuel",
    body: "Thanks for your purchase. Total: $412.09.",
    fromAddr: "billing@acmefuel.test-real.com",
    expect: false,
  },
  {
    why: "insurance vocabulary with no request — a renewal notice",
    subject: "Policy renewal notice",
    body:
      "Your commercial auto policy renews on 01/01. Coverage and limits are unchanged.\n" +
      "No action is required.",
    fromAddr: "notices@carrierco.test-real.com",
    expect: false,
  },
  {
    why: "newsletter about the insurance industry",
    subject: "This week in trucking",
    body: "Freight rates softened again, and three carriers exited the market.",
    fromAddr: "editor@truckingweekly.test-real.com",
    expect: false,
  },
  {
    why: "'certificate' in an unrelated sense",
    subject: "SSL certificate expiring",
    body: "The certificate for your domain expires in 14 days. Renew it to avoid downtime.",
    fromAddr: "alerts@hosting.test-real.com",
    expect: false,
  },
  {
    why: "empty message",
    subject: "",
    body: "",
    fromAddr: "someone@somewhere.test-real.com",
    expect: false,
  },
];

console.log("\nMailbox filter — only COI requests reach the dashboard\n");

for (const c of CASES) {
  const verdict = classifyEmail({ subject: c.subject, body: c.body, fromAddr: c.fromAddr });
  check(
    `  ${c.expect ? "admits " : "refuses"} ${c.why}`,
    verdict.isRequest === c.expect,
    `score ${verdict.score} — ${verdict.reason.slice(0, 70)}`
  );
}

// The escape hatch has to actually work, or debugging a wrong skip is guesswork.
process.env.GMAIL_INGEST_ALL = "1";
check(
  "  GMAIL_INGEST_ALL=1 disables the filter",
  classifyEmail({ subject: "Lunch Thursday?", body: "", fromAddr: "a@b.com" }).isRequest
);
delete process.env.GMAIL_INGEST_ALL;

console.log(
  failures ? `\n${failures} FAILED\n` : `\nAll ${CASES.length + 1} checks passed.\n`
);
process.exit(failures ? 1 : 0);
