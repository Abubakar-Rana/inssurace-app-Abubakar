/**
 * Asking the requester which company they meant, and reading their answer.
 *
 * The reading half is pure and tested here exhaustively. The lookup half needs
 * the database — it is exercised against the seeded pair of near-identical
 * companies, which is the whole reason that pair exists.
 *
 *   npm run verify:clarify
 */

import "@/lib/env";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/db/schema";
import { readIdentifiers, resolveByIdentifier } from "@/lib/matching/identifier";
import { referencedIds } from "@/lib/gmail/inbox";
import { composeClarification, readClarification } from "@/lib/matching/clarify";
import { resolveClient } from "@/lib/matching/resolve";
import type { Candidate } from "@/lib/matching/resolve";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

// ---------------------------------------------------------------- identifiers

console.log("\nreading federal identifiers out of a reply:\n");

const ID_CASES: { why: string; text: string; dot?: string; mc?: string }[] = [
  // ---- the company name sits between the label and the number ----
  //
  // This is how people actually answer, and an earlier version failed all of
  // them: the gap only allowed a fixed list of connecting words, so any
  // sentence containing the company name broke the match silently.
  { why: "company name mid-sentence, colon before digits", text: "yeah sure thing the MC number for Smartway Solutions is :  1043790", mc: "1043790" },
  { why: "company name mid-sentence", text: "the MC number for Smartway Solutions is 1043790", mc: "1043790" },
  { why: "label, company, is, number", text: "MC for Smart Way Solutions LLC is 1043790", mc: "1043790" },
  { why: "em dash and company name", text: "Sure — DOT for Smartway Solutions is 3121884", dot: "3121884" },

  // ---- the way people actually write ----
  { why: "conversational, mid-sentence", text: "Hi,\n\nSo the MC number is 1084463.\nDo you get it and can you do this?", mc: "1084463" },
  { why: "just the number after the label", text: "MC 1084463", mc: "1084463" },
  { why: "with a hash", text: "MC# 1084463", mc: "1084463" },
  { why: "hash before the digits", text: "MC #1084463", mc: "1084463" },
  { why: "with a colon", text: "MC: 1084463", mc: "1084463" },
  { why: "hyphenated", text: "MC-1084463", mc: "1084463" },
  { why: "no space at all", text: "MC1084463", mc: "1084463" },
  { why: "'No.' abbreviation", text: "MC No. 1084463", mc: "1084463" },
  { why: "'number is'", text: "The MC number is 1084463", mc: "1084463" },
  { why: "possessive", text: "our MC is 1084463, thanks", mc: "1084463" },
  { why: "apologetic opener", text: "Sorry! It's MC 1084463.", mc: "1084463" },
  { why: "spelled out", text: "The motor carrier number is 1084463.", mc: "1084463" },
  { why: "number first, label after", text: "1084463 is our MC number.", mc: "1084463" },

  { why: "USDOT run together", text: "USDOT 3121884", dot: "3121884" },
  { why: "US DOT spaced", text: "US DOT 3121884", dot: "3121884" },
  { why: "DOT with a hash", text: "DOT#3121884 please", dot: "3121884" },
  { why: "DOT 'No.'", text: "US DOT No. 3121884", dot: "3121884" },
  { why: "DOT conversational", text: "Our DOT number is 3121884 if that helps.", dot: "3121884" },
  { why: "dotted abbreviation", text: "D.O.T. 3121884", dot: "3121884" },
  { why: "DOT number first", text: "3121884 is the DOT number.", dot: "3121884" },

  { why: "both, conversationally", text: "The DOT is 3121884 and the MC number is 1084463.", dot: "3121884", mc: "1084463" },
  { why: "MX prefix is the same register", text: "MX 123456", mc: "123456" },
];

for (const c of ID_CASES) {
  const got = readIdentifiers(c.text);
  check(
    `  reads ${c.why}`,
    got.dot === c.dot && got.mc === c.mc,
    JSON.stringify(got)
  );
}

// The refusals matter more. A bare number in an email is far more likely to be
// a policy number or a phone extension than a federal identifier, and treating
// one as a DOT number would silently select a company nobody named.
const NOT_IDS = [
  { why: "a bare number", text: "Reference 3121884, thanks." },
  { why: "a policy number", text: "Policy 2026256248 expires soon." },
  { why: "a phone number", text: "Call me on 336-390-1319." },
  { why: "a zip code", text: "We are at 28673-9763." },
  { why: "no numbers at all", text: "It's the one in North Carolina." },
  // The dangerous one. A label with no number of its own, then a DIFFERENT
  // number in the next sentence. Reading across the full stop would pick the
  // policy number and confidently select the wrong company.
  { why: "a label, then a new sentence with another number",
    text: "I don't have the MC handy. Our policy is 2026256248." },
  { why: "a DOT label, then a new sentence",
    text: "No DOT to hand. Invoice 3121884 is attached." },
  { why: "'dot' inside an ordinary word", text: "The dotted line needs 2026256248." },
];
for (const c of NOT_IDS) {
  const got = readIdentifiers(c.text);
  check(`  refuses ${c.why}`, !got.dot && !got.mc, JSON.stringify(got));
}

// ---------------------------------------------------------------- the reply

console.log("\nreading which company the requester chose:\n");

const CANDIDATES: Candidate[] = [
  { clientId: "a", clientNumber: "SWS-1001", legalName: "Smart Way Solutions Inc", matchedOn: "Smart Way Solutions Inc", viaAlias: false, score: 0.9 },
  { clientId: "b", clientNumber: "SWS-1002", legalName: "Smart Way Solutions LLC", matchedOn: "Smart Way Solutions LLC", viaAlias: false, score: 0.89 },
];

const question = composeClarification("Smartway Solutions", CANDIDATES, "Whittington Agency, LLC");

check(
  "  the question names both candidates",
  question.includes("Smart Way Solutions Inc") && question.includes("Smart Way Solutions LLC")
);
check("  the question asks for a DOT or MC number", /USDOT/.test(question) && /MC number/.test(question));
check(
  "  the question says no certificate has been issued",
  /No\s*\n?certificate has been issued|no certificate has been issued/i.test(question)
);
check(
  "  the question discloses no addresses or client numbers",
  !question.includes("SWS-1001") && !question.includes("Tallent")
);

const answered = (text: string) => readClarification(text, CANDIDATES);

check("  an MC number is read as an identifier", answered("MC 1084463").kind === "identifier");
check("  a USDOT number is read as an identifier", answered("USDOT 2988014").kind === "identifier");

const byName = answered("It's Smart Way Solutions LLC.");
check(
  "  a full legal name picks that candidate",
  byName.kind === "name" && byName.candidate.legalName === "Smart Way Solutions LLC",
  byName.kind
);

// The number wins when both appear: it is exact where a name is not.
const both = answered("Smart Way Solutions Inc, MC 1084463");
check("  an identifier beats a name in the same reply", both.kind === "identifier", both.kind);

// The reply carries our own question quoted underneath, and our question lists
// EVERY candidate. Reading that back would make every reply look ambiguous.
const quoted = [
  "It's the LLC one — Smart Way Solutions LLC.",
  "",
  "On Mon, 1 Sep 2026 at 09:14, Certificates <certs@agency.test-real.com> wrote:",
  "> \"Smartway Solutions\" matches more than one of our insureds:",
  ">   - Smart Way Solutions Inc",
  ">   - Smart Way Solutions LLC",
  ">   - the carrier's USDOT number   (for example: USDOT 1234567)",
].join("\n");
const fromQuoted = readClarification(quoted, CANDIDATES);
check(
  "  the quoted question is ignored",
  fromQuoted.kind === "name" && fromQuoted.candidate.legalName === "Smart Way Solutions LLC",
  fromQuoted.kind === "none" ? fromQuoted.reason : fromQuoted.kind
);

check(
  "  a reply naming both settles nothing",
  answered("Could be Smart Way Solutions Inc or Smart Way Solutions LLC").kind === "none"
);
check("  an unhelpful reply settles nothing", answered("The usual one, thanks.").kind === "none");
check("  an empty reply settles nothing", answered("").kind === "none");


// ---------------------------------------------------------------- reply linking

console.log("\ntying a reply back to the request it answers:\n");

// These are what a real Gmail reply carries. The bug this guards against was a
// regex that had lost its backslash - `split(/s+/)` instead of `split(/\s+/)` -
// so every Message-ID containing the letter "s" was shredded into fragments,
// nothing matched, and the reply was ingested as a NEW request. The system then
// asked the same person the same question again.
const ORIGINAL = "<CAJ7sSomeThing-original@mail.gmail.com>";
const OURS = "<b3s9f1a2-clarification@mail.gmail.com>";

check(
  "  a single in-reply-to header is read",
  referencedIds({ inReplyTo: ORIGINAL }).includes(ORIGINAL),
  JSON.stringify(referencedIds({ inReplyTo: ORIGINAL }))
);

// The chain arrives as ONE space-separated string, which is where the broken
// split did its damage.
const chain = referencedIds({ inReplyTo: OURS, references: `${ORIGINAL} ${OURS}` });
check(
  "  a space-separated chain keeps whole ids",
  chain.includes(ORIGINAL) && chain.includes(OURS),
  JSON.stringify(chain)
);
check(
  "  ids containing the letter 's' survive intact",
  chain.every((id) => id.startsWith("<") && id.endsWith(">")),
  JSON.stringify(chain)
);
check(
  "  the ORIGINAL request is reachable from a reply to our question",
  chain.includes(ORIGINAL),
  "this is what links the answer to the request"
);

// Some clients newline-separate the chain instead.
const wrapped = referencedIds({ references: `${ORIGINAL}\n ${OURS}` });
check(
  "  a newline-wrapped chain is read too",
  wrapped.includes(ORIGINAL) && wrapped.includes(OURS),
  JSON.stringify(wrapped)
);

check("  no headers means nothing to link", referencedIds({}).length === 0);
check(
  "  duplicates are collapsed",
  referencedIds({ inReplyTo: ORIGINAL, references: ORIGINAL }).length === 1
);

// ---------------------------------------------------------------- the lookup

async function main() {
  console.log("\nlooking a company up by its federal identifier:\n");

  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, "whittington"));
  if (!tenant) throw new Error("Tenant not seeded. Run: npm run db:seed");

  // The pair of near-identical names is the point. If the resolver can tell
  // these apart on the name alone, the seed is wrong, not the resolver.
  const ambiguous = await resolveClient(tenant.id, "Smartway Solutions");
  check(
    "  the name alone is genuinely ambiguous",
    ambiguous.decision !== "matched",
    `${ambiguous.decision}: ${ambiguous.candidates.map((c) => c.legalName).join(" | ")}`
  );

  const byDot = await resolveByIdentifier(tenant.id, { dot: "3121884" });
  check(
    "  a USDOT number resolves exactly one company",
    byDot?.legalName === "Smart Way Solutions Inc",
    byDot ? `${byDot.legalName} via ${byDot.matchedOn}` : "no match"
  );

  const byMc = await resolveByIdentifier(tenant.id, { mc: "1043790" });
  check(
    "  an MC number resolves the OTHER company",
    byMc?.legalName === "Smart Way Solutions LLC",
    byMc ? `${byMc.legalName} via ${byMc.matchedOn}` : "no match"
  );

  check(
    "  a number we do not insure resolves to nothing",
    (await resolveByIdentifier(tenant.id, { dot: "9999999" })) === null
  );
  check(
    "  no identifier at all resolves to nothing",
    (await resolveByIdentifier(tenant.id, {})) === null
  );

  // Digits only, so the stored value and the typed value compare equal however
  // the requester punctuated it.
  const punctuated = await resolveByIdentifier(tenant.id, { mc: "MC-1084463".replace(/\D/g, "") });
  check("  punctuation in the number does not matter", punctuated?.legalName === "Smart Way Solutions Inc");

  console.log(failures ? `\n${failures} FAILED\n` : `\nAll checks passed.\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
