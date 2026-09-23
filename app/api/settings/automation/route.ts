/** PUT /api/settings/automation — { autoSend: boolean } */

import { json, readJson, route } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { setAutoSend } from "@/lib/admin/agencySettings";

export const dynamic = "force-dynamic";

export const PUT = route(async (session, req) => {
  requireAdmin(session);
  const body = await readJson<{ autoSend?: unknown }>(req);
  await setAutoSend(session, body.autoSend);
  return json({ ok: true });
});
