/**
 * GET /api/clients?q= — the insured list, for picking one by hand.
 *
 * Used when the resolver abstained. It deliberately does NOT reuse the fuzzy
 * matcher's thresholds: those exist to decide whether the machine may act
 * alone, and a human choosing from a list needs breadth instead. Plain
 * substring search, ordered by name.
 */

import { asc, ilike, or, sql } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { clientAliases, clients } from "@/db/schema";
import { json, route } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = route(async (session, req) => {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  const term = `%${q}%`;

  const rows = await withTenant(session.tenantId, async (tx) =>
    tx
      .select({
        id: clients.id,
        clientNumber: clients.clientNumber,
        legalName: clients.legalName,
        addressLines: clients.addressLines,
      })
      .from(clients)
      .where(
        q
          ? or(
              ilike(clients.legalName, term),
              ilike(clients.clientNumber, term),
              // Aliases are how a client is known to the outside world, so a
              // reviewer searching the name from the email should find them.
              sql`exists (select 1 from ${clientAliases} a
                          where a.client_id = ${clients.id} and a.alias ilike ${term})`
            )
          : undefined
      )
      .orderBy(asc(clients.legalName))
      .limit(25)
  );

  return json({ clients: rows });
});
