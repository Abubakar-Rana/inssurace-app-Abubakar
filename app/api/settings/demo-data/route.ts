/**
 * POST /api/settings/demo-data — { action: "load" | "remove" }
 *
 * The demonstration clients and policies a new agency starts with. Reloading is
 * idempotent; removing never touches real or NowCerts-synced records, and keeps
 * any demo client an issued certificate still refers to.
 */

import { json, readJson, route } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { ServiceError } from "@/lib/certificate/service";
import { demoDataStatus, loadDemoData, removeDemoData } from "@/lib/admin/demoData";

export const dynamic = "force-dynamic";

export const POST = route(async (session, req) => {
  requireAdmin(session);
  const { action } = await readJson<{ action?: unknown }>(req);
  const actor = { userId: session.userId, by: session.email };

  if (action === "load") return json({ demo: await loadDemoData(session.tenantId, actor) });
  if (action === "remove") {
    const result = await removeDemoData(session.tenantId, actor);
    return json({ ...result, demo: await demoDataStatus(session.tenantId) });
  }
  throw new ServiceError("Action must be load or remove.");
});
