/**
 * GET /api/settings — everything the Settings screen shows, for agency admins.
 *
 * Contains no secret. Stored passwords are reported only as `passwordSet`.
 */

import { json, route } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { getAgencyOverview } from "@/lib/admin/agencySettings";
import { getMailSettingsView } from "@/lib/mail/settings";
import { getNowcertsView } from "@/lib/nowcerts/settings";
import { demoDataStatus } from "@/lib/admin/demoData";

export const dynamic = "force-dynamic";

export const GET = route(async (session) => {
  requireAdmin(session);
  const [overview, mail, nowcerts, demo] = await Promise.all([
    getAgencyOverview(session.tenantId),
    getMailSettingsView(session.tenantId, session.tenantSlug),
    getNowcertsView(session.tenantId),
    demoDataStatus(session.tenantId),
  ]);
  return json({ ...overview, mail, nowcerts, demo, canManageUsers: session.canManageUsers });
});
