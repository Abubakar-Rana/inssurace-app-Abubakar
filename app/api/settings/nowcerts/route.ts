/**
 * PUT    /api/settings/nowcerts — save NowCerts credentials (tested first unless test=false)
 * DELETE /api/settings/nowcerts — disconnect; the agency goes back to CertFlow data
 */

import { json, readJson, route } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { disconnectNowcerts, saveNowcerts, type NowcertsInput } from "@/lib/nowcerts/settings";

export const dynamic = "force-dynamic";

export const PUT = route(async (session, req) => {
  requireAdmin(session);
  const body = await readJson<NowcertsInput & { test?: boolean }>(req);
  return json({ ok: true, ...(await saveNowcerts(session, body, { test: body.test !== false })) });
});

export const DELETE = route(async (session) => {
  requireAdmin(session);
  await disconnectNowcerts(session);
  return json({ ok: true });
});
