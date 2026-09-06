/**
 * GET /api/certificates — every certificate, newest first.
 *
 * One row per certificate, including superseded revisions: a corrected
 * certificate does not erase the one the holder already received, and an
 * agency asked "what did we send them in July?" needs to see it.
 */

import { sql } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { json, route } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = route(async (session) => {
  const rows = await withTenant(session.tenantId, (tx) =>
    tx.execute(sql`
      select c.id,
             c.certificate_number as "certificateNumber",
             c.revision,
             c.status,
             -- ISO-8601 explicitly; see the note in app/api/requests/route.ts.
             to_char(c.created_at at time zone 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "createdAt",
             to_char(c.approved_at at time zone 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "approvedAt",
             c.request_id         as "requestId",
             cl.legal_name        as "insuredName",
             cl.client_number     as "clientNumber",
             d.to_addr            as "sentTo",
             d.sent_at            as "sentAt",
             d.n                  as "deliveryCount"
      from certificates c
      join clients cl on cl.id = c.client_id
      left join lateral (
        select to_addr,
               to_char(sent_at at time zone 'UTC',
                       'YYYY-MM-DD"T"HH24:MI:SS"Z"') as sent_at,
               count(*) over () as n
        from deliveries
        where certificate_id = c.id
        order by sent_at desc
        limit 1
      ) d on true
      order by c.created_at desc
      limit 200
    `)
  );

  const certificates = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []);
  return json({ certificates });
});
