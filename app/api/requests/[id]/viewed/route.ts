/**
 * POST /api/requests/:id/viewed — a reviewer has looked at this request.
 *
 * Drives the unread count on the dashboard. Recorded on the server rather than
 * in the browser because "has anyone dealt with this?" is a fact about the
 * agency, not about one laptop: a request opened on a desktop should not still
 * be flagged as new on someone's phone.
 *
 * First write wins. The timestamp records when the request was FIRST seen, so
 * re-opening it later does not reset it and nobody can make a request look
 * freshly handled by clicking into it again.
 */

import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { coiRequests } from "@/db/schema";
import { json, route } from "@/lib/api";
import { requireWrite } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(async (session, _req, { params }) => {
  requireWrite(session);

  const viewedAt = await withTenant(session.tenantId, async (tx) => {
    const [row] = await tx
      .update(coiRequests)
      .set({ viewedAt: new Date(), viewedBy: session.userId })
      .where(and(eq(coiRequests.id, params.id), isNull(coiRequests.viewedAt)))
      .returning({ viewedAt: coiRequests.viewedAt });
    return row?.viewedAt ?? null;
  });

  // No audit entry. Opening a request changes nothing about the certificate or
  // the coverage it asserts, and logging every screen view would bury the
  // entries that record real decisions.
  return json({ viewedAt });
});
