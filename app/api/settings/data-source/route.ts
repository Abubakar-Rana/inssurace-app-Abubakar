/** PUT /api/settings/data-source — { dataSource: "certflow" | "nowcerts" } */

import { json, readJson, route } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { setDataSource } from "@/lib/nowcerts/settings";

export const dynamic = "force-dynamic";

export const PUT = route(async (session, req) => {
  requireAdmin(session);
  const body = await readJson<{ dataSource?: unknown }>(req);
  await setDataSource(session, body.dataSource);
  return json({ ok: true });
});
