/** PUT /api/settings/producer — the PRODUCER block printed on this agency's certificates. */

import { json, readJson, route } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { saveProducer } from "@/lib/admin/agencySettings";

export const dynamic = "force-dynamic";

export const PUT = route(async (session, req) => {
  requireAdmin(session);
  await saveProducer(session, await readJson<Record<string, unknown>>(req));
  return json({ ok: true });
});
