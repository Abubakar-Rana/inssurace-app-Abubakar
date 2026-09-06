/**
 * Entity resolution, tested against names as people actually write them.
 *
 * Half these cases assert that the resolver ABSTAINS. That is the point: a
 * matcher judged only on how often it answers will happily answer wrongly, and
 * the wrong insured on a certificate is the failure mode that matters. Cases
 * marked `ambiguous` or `noMatch` are as much a pass as the matches.
 *
 *   npm run verify:matching
 */

import "@/lib/env";
import { eq } from "drizzle-orm";
import { db, withTenant } from "@/lib/db/client";
import { clientAliases, clients, tenants } from "@/db/schema";
import { decide, normalizeName, resolveClient, type MatchDecision } from "@/lib/matching/resolve";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

interface Case {
  query: string;
  expect: MatchDecision;
  /** Legal name expected when `expect === "matched"`. */
  client?: string;
  why: string;
}

const CASES: Case[] = [
  // ---- should match ----
  { query: "Smart Way Solutions Inc", expect: "matched", client: "Smart Way Solutions Inc", why: "exact legal name" },
  { query: "smart way solutions inc", expect: "matched", client: "Smart Way Solutions Inc", why: "case-insensitive" },
  { query: "Smart Way Solutions, LLC", expect: "matched", client: "Smart Way Solutions LLC", why: "suffix decides it" },
  { query: "SmartWay Solutions LLC", expect: "matched", client: "Smart Way Solutions LLC", why: "spacing does not, suffix does" },
  { query: "Smart Way Soluitons Inc", expect: "matched", client: "Smart Way Solutions Inc", why: "transposed letters" },

  // ---- ambiguous BECAUSE the agency insures two companies with this name ----
  //
  // These used to match. They stopped when a second, near-identically named
  // client was seeded — and stopping is the correct behaviour, not a
  // regression. A bare "Smart Way Solutions" genuinely does not say whether the
  // Inc or the LLC is meant, and the two carry different policies.
  //
  // This is the case the system now resolves by asking the requester for a
  // USDOT or MC number. See scripts/verify-clarify.ts.
  { query: "Smart Way Solutions", expect: "ambiguous", why: "suffix omitted, two clients qualify" },
  { query: "Smartway Solutions", expect: "ambiguous", why: "spelling matches both equally" },
  // ---- should refuse ----
  { query: "Roadrunner Freight Systems", expect: "noMatch", why: "a different company entirely" },
  { query: "", expect: "noMatch", why: "empty input" },
  { query: "the", expect: "noMatch", why: "a stopword, not a name" },
  { query: "Inc", expect: "noMatch", why: "suffix alone carries no identity" },
  { query: "Solutions", expect: "ambiguous", why: "one generic word — too weak to act on" },
];

async function main() {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, "whittington"));
  if (!tenant) throw new Error("Tenant not seeded. Run: npm run db:seed");

  // ---- normalisation is the foundation; test it directly ----
  console.log("normalisation:");
  const norm: [string, string][] = [
    ["Smart Way Solutions Inc", "smart way solutions"],
    ["SMART WAY SOLUTIONS, L.L.C.", "smart way solutions"],
    ["Smith & Sons Trucking Co.", "smith and sons"],
    ["Trucking Inc", "trucking"], // never normalises to nothing
  ];
  for (const [input, expected] of norm) {
    const got = normalizeName(input);
    check(`  "${input}"`, got === expected, `-> "${got}"`);
  }

  // ---- a second, deliberately similar client: the near-miss case ----
  // Two real companies whose names differ by one word must NOT auto-match,
  // because picking the wrong one certifies the wrong policy.
  const decoyId = await withTenant(tenant.id, async (tx) => {
    const [decoy] = await tx
      .insert(clients)
      .values({
        tenantId: tenant.id,
        clientNumber: "SWS-9999",
        legalName: "Smart Way Solutions of Ohio Inc",
        addressLines: "1 Test Way\nColumbus, OH 43004",
      })
      .returning();
    return decoy.id;
  });

  try {
    console.log("\nresolution:");
    for (const c of CASES) {
      const r = await resolveClient(tenant.id, c.query);
      const decisionOk = r.decision === c.expect;
      const clientOk = c.expect !== "matched" || r.client?.legalName === c.client;
      check(
        `  ${JSON.stringify(c.query).padEnd(28)} -> ${r.decision.padEnd(9)} (${c.why})`,
        decisionOk && clientOk,
        decisionOk ? "" : `expected ${c.expect}; ${r.reason}`
      );
    }

    // ---- the near-miss, stated explicitly ----
    console.log("\nnear-miss safety:");
    const ohio = await resolveClient(tenant.id, "Smart Way Solutions of Ohio");
    check(
      "  distinguishes the Ohio entity",
      ohio.decision === "matched" && ohio.client?.legalName === "Smart Way Solutions of Ohio Inc",
      ohio.reason
    );

    const bare = await resolveClient(tenant.id, "Smart Way");
    check(
      "  bare prefix does not silently pick one",
      bare.decision !== "matched",
      `${bare.decision}: ${bare.reason}`
    );
  } finally {
    await withTenant(tenant.id, (tx) => tx.delete(clients).where(eq(clients.id, decoyId)));
  }

  // ---- abstention rules, unit-tested without the database ----
  console.log("\ndecision rules:");
  const cand = (legalName: string, score: number) => ({
    clientId: legalName,
    clientNumber: "X",
    legalName,
    matchedOn: legalName,
    viaAlias: false,
    score,
  });
  check("  clear leader matches", decide([cand("A", 0.9), cand("B", 0.4)]).decision === "matched");
  check("  near-tie abstains", decide([cand("A", 0.9), cand("B", 0.85)]).decision === "ambiguous");
  check("  weak leader abstains", decide([cand("A", 0.5)]).decision === "ambiguous");
  check("  nothing viable is noMatch", decide([cand("A", 0.1)]).decision === "noMatch");
  check("  empty list is noMatch", decide([]).decision === "noMatch");

  // Candidates are always returned, so a human sees the alternatives.
  const tie = decide([cand("A", 0.9), cand("B", 0.85)]);
  check("  ambiguous still lists candidates", tie.candidates.length === 2);

  // ---- aliases are what make the misspellings work ----
  const aliasCount = await withTenant(tenant.id, async (tx) =>
    (await tx.select().from(clientAliases)).length
  );
  console.log(`\n${aliasCount} alias(es) seeded`);

  console.log(`\n${failures === 0 ? "all matching checks passed" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
