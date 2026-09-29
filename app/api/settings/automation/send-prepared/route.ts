/**
 * POST /api/settings/automation/send-prepared
 *
 * Sends the certificates that were drafted BEFORE auto-send was switched on.
 *
 * Turning the switch on deliberately does not sweep the backlog: an agency
 * enabling a setting should not, by that click alone, email a week of prepared
 * documents to their requesters. This is that sweep, asked for explicitly, and
 * it runs the ordinary auto-send path per request — same confidence rule, same
 * approve-then-deliver, same audit, same flag on anything it cannot finish.
 */

import { and, eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { certificates, coiRequests, tenants } from "@/db/schema";
import { json, route } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { ServiceError } from "@/lib/certificate/service";
import { maybeAutoSend } from "@/lib/certificate/autoSend";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = route(async (session) => {
  requireAdmin(session);

  const pending = await withTenant(session.tenantId, async (tx) => {
    const [tenant] = await tx.select({ autoSend: tenants.autoSend }).from(tenants).where(eq(tenants.id, session.tenantId));
    if (!tenant?.autoSend) {
      throw new ServiceError("Turn automatic sending on first — this only sends what it would have sent.", 409);
    }
    return tx
      .select({ id: coiRequests.id })
      .from(coiRequests)
      .innerJoin(certificates, eq(certificates.requestId, coiRequests.id))
      .where(and(eq(coiRequests.status, "ready"), eq(certificates.status, "draft")));
  });

  let sent = 0;
  let flagged = 0;
  for (const request of pending) {
    const result = await maybeAutoSend(session.tenantId, request.id);
    if (result.sent) sent++;
    else if (result.flagged) flagged++;
  }
  return json({ considered: pending.length, sent, flagged });
});
