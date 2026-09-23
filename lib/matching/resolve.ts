/**
 * Entity resolution: an insured's name as someone typed it -> the client record.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IS CAREFUL
 *
 * Matching the wrong insured means issuing a certificate that states someone
 * else's coverage. That is worse than issuing nothing: the holder relies on it,
 * and the agency has certified a policy that does not cover the named party.
 *
 * So this resolver is built to ABSTAIN rather than guess. It returns a decision
 * of `matched` only when one candidate is both strong AND clearly ahead of the
 * next one; everything else routes to a human. A near-tie between two clients
 * is treated as a failure to identify, not as a 51% win — "Smith Trucking LLC"
 * and "Smith Trucking of Ohio LLC" are different companies with different
 * policies, and the difference between them is exactly one word.
 *
 * There is no AI here. An LLM will later read the email and decide which words
 * are the company name; this file decides which record that name refers to, by
 * comparing strings to the system of record. Keeping the two separate is what
 * makes "the LLM decides what was asked for, the database decides what is true"
 * enforceable rather than aspirational.
 * ---------------------------------------------------------------------------
 */

import { sql } from "drizzle-orm";
import { withTenant, type TenantDb } from "@/lib/db/client";

export type MatchDecision = "matched" | "ambiguous" | "noMatch";

export interface Candidate {
  clientId: string;
  clientNumber: string;
  legalName: string;
  /** The stored string that matched — the legal name, or an alias. */
  matchedOn: string;
  /** Whether `matchedOn` was an alias rather than the legal name. */
  viaAlias: boolean;
  /** 0–1. Trigram similarity, after the bonuses described below. */
  score: number;
}

export interface Resolution {
  decision: MatchDecision;
  /** Set only when `decision === "matched"`. */
  client: Candidate | null;
  /** Ranked, best first. Populated for every decision, so a human reviewing an
   *  `ambiguous` result sees what the system was choosing between. */
  candidates: Candidate[];
  /** Human-readable reason, suitable for `coiRequests.matchConfidence`. */
  reason: string;
}

/** Below this, a candidate is not worth showing a human. */
const FLOOR = 0.3;

/** At or above this, a candidate is strong enough to auto-match. */
const STRONG = 0.62;

/** The leader must beat the runner-up by this much, or it's a near-tie. */
const MARGIN = 0.12;

/** How many candidates to keep for review. */
const SHORTLIST = 5;

/**
 * Strip the noise that makes two spellings of one company look different.
 *
 * Company suffixes are the main offender: "Smart Way Solutions Inc" and "Smart
 * Way Solutions, LLC" are overwhelmingly the same firm, and the suffix is the
 * least informative part of the string. Dropping it before comparison stops the
 * suffix from carrying weight it hasn't earned — but the suffix is kept on the
 * stored record, because the certificate must print the legal name exactly.
 */
const SUFFIXES = new Set([
  "inc", "incorporated", "llc", "llp", "lp", "ltd", "limited", "co", "corp",
  "corporation", "company", "plc", "pllc", "pc", "dba", "trucking", "transport",
  "transportation", "logistics", "carriers", "carrier", "express", "group",
  "holdings", "enterprises", "services",
]);

export function normalizeName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    // Periods close up rather than split, so "L.L.C." becomes "llc" and hits
    // the suffix list. Splitting on them yields "l l c", which does not.
    .replace(/\./g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const words = cleaned.split(" ").filter(Boolean);

  // Only drop trailing suffixes, and never all of them — "Trucking Inc" as a
  // whole name would otherwise normalise to nothing.
  const kept = [...words];
  while (kept.length > 1 && SUFFIXES.has(kept[kept.length - 1])) kept.pop();

  return kept.join(" ");
}

/**
 * Rank candidates from the database.
 *
 * `pg_trgm` does the fuzzy work — it is installed with GIN indexes on
 * `clients.legal_name` and `client_aliases.alias` (db/rls.sql), so this stays a
 * single indexed query rather than pulling every client into memory.
 */
async function rank(tx: TenantDb, query: string): Promise<Candidate[]> {
  const normalized = normalizeName(query);
  if (!normalized) return [];

  // similarity() is compared against both the raw and normalised stored names,
  // taking whichever is better: normalising helps "Inc" vs "LLC", but hurts
  // when the real name genuinely ends in a suffix-like word.
  const rows = await tx.execute<{
    client_id: string;
    client_number: string;
    legal_name: string;
    matched_on: string;
    via_alias: boolean;
    score: number;
  }>(sql`
    with candidates as (
      select c.id            as client_id,
             c.client_number as client_number,
             c.legal_name    as legal_name,
             c.legal_name    as matched_on,
             false           as via_alias,
             greatest(
               similarity(lower(c.legal_name), ${query.toLowerCase()}),
               similarity(lower(c.legal_name), ${normalized})
             ) as score
      from clients c
      -- A retired client (e.g. no live policy left in NowCerts) must not win a
      -- match; the DOT/MC lookup in identifier.ts applies the same rule.
      where c.status = 'active'
      union all
      select c.id, c.client_number, c.legal_name,
             a.alias as matched_on,
             true    as via_alias,
             greatest(
               similarity(lower(a.alias), ${query.toLowerCase()}),
               similarity(lower(a.alias), ${normalized})
             ) as score
      from client_aliases a
      join clients c on c.id = a.client_id
      where c.status = 'active'
    )
    -- One row per client: an alias hit and a legal-name hit are evidence for
    -- the same company, so keep only its best evidence.
    select distinct on (client_id) *
    from candidates
    where score > 0
    order by client_id, score desc
  `);

  const scored = (rows as unknown as { rows?: unknown[] }).rows ?? rows;

  return (scored as Record<string, unknown>[])
    .map((r) => {
      const legalName = String(r.legal_name);
      const matchedOn = String(r.matched_on);
      const score = Number(r.score);

      // NOTE: an earlier version added a bonus when one name's words were a
      // subset of the other's. It was removed because it rewarded the wrong
      // thing: "Smart Way Solutions" is contained in "Smart Way Solutions of
      // Ohio", so the bonus pushed a DIFFERENT company to a perfect score and
      // made the two indistinguishable. The extra words in a longer stored
      // name are precisely what separates two related entities — treating
      // them as noise is how you certify the wrong policy. Suffix handling
      // belongs in normalizeName(), where it can be reasoned about; general
      // containment does not belong in the score at all.
      return {
        clientId: String(r.client_id),
        clientNumber: String(r.client_number),
        legalName,
        matchedOn,
        viaAlias: r.via_alias === true,
        score: Number(score.toFixed(4)),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, SHORTLIST);
}

/** Apply the abstention rules to a ranked list. */
export function decide(candidates: Candidate[]): Resolution {
  const viable = candidates.filter((c) => c.score >= FLOOR);

  if (!viable.length) {
    return {
      decision: "noMatch",
      client: null,
      candidates,
      reason: "No client resembles that name.",
    };
  }

  const [best, next] = viable;

  if (best.score < STRONG) {
    return {
      decision: "ambiguous",
      client: null,
      candidates: viable,
      reason: `Best match "${best.legalName}" scored ${best.score.toFixed(2)}, below the ${STRONG} auto-match threshold.`,
    };
  }

  if (next && best.score - next.score < MARGIN) {
    return {
      decision: "ambiguous",
      client: null,
      candidates: viable,
      reason: `"${best.legalName}" (${best.score.toFixed(2)}) and "${next.legalName}" (${next.score.toFixed(2)}) are too close to call.`,
    };
  }

  return {
    decision: "matched",
    client: best,
    candidates: viable,
    reason: best.viaAlias
      ? `Matched "${best.matchedOn}" (known alias) at ${best.score.toFixed(2)}.`
      : `Matched legal name at ${best.score.toFixed(2)}.`,
  };
}

/** Resolve a name within one tenant. */
export async function resolveClient(
  tenantId: string,
  query: string,
  tx?: TenantDb
): Promise<Resolution> {
  const run = async (tx: TenantDb) => decide(await rank(tx, query));
  return tx ? run(tx) : withTenant(tenantId, run);
}
