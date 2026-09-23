/** POST /api/settings/nowcerts/sync — pull from NowCerts now instead of waiting for the schedule. */

import { json, route } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { ServiceError } from "@/lib/certificate/service";
import { syncTenant } from "@/lib/nowcerts/sync";
import { NowCertsError } from "@/lib/nowcerts/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = route(async (session) => {
  requireAdmin(session);
  try {
    return json({ stats: await syncTenant(session.tenantId, session.userId) });
  } catch (err) {
    if (err instanceof NowCertsError) throw new ServiceError(err.message, 422);
    throw err;
  }
});
