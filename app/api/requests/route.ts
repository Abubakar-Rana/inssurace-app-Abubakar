/** GET /api/requests — the inbox. */

import { sql } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { json, route } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * One row per request — never per certificate.
 *
 * A plain join to `certificates` duplicates a request once per revision, so a
 * corrected certificate makes its request appear twice in the inbox. The
 * lateral picks the newest revision and nothing else.
 *
 * RLS scopes every table here, so there are no tenant predicates to forget.
 */
export const GET = route(async (session) => {
  const rows = await withTenant(session.tenantId, async (tx) =>
    tx.execute(sql`
      select r.id,
             r.from_addr        as "fromAddr",
             r.from_name        as "fromName",
             r.subject,
             -- Explicit ISO-8601. The driver renders timestamptz as
             -- "2026-07-16 14:12:00+00", which the UI's hand-written date
             -- formatters (which split on "T" to avoid Date in render) cannot
             -- parse — they silently produced "12:undefined AM".
             to_char(r.received_at at time zone 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "receivedAt",
             r.status,
             r.match_confidence as "matchConfidence",
             -- Null until a reviewer opens it. This is what the unread count
             -- on the dashboard counts.
             to_char(r.viewed_at at time zone 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "viewedAt",
             r.client_id        as "clientId",
             c.legal_name       as "insuredName",
             c.client_number    as "clientNumber",
             cert.id            as "certificateId",
             cert.status        as "certificateStatus",
             cert.revision      as "certificateRevision"
      from coi_requests r
      left join clients c on c.id = r.client_id
      left join lateral (
        select id, status, revision
        from certificates
        where request_id = r.id
        order by revision desc
        limit 1
      ) cert on true
      order by r.received_at desc
    `)
  );

  // postgres-js returns the row array directly; drizzle wraps it on some
  // drivers. Accept either shape rather than depending on the driver.
  const requests = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []);
  return json({ requests });
});
