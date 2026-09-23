/**
 * PUT    /api/settings/mail — save the agency mailbox (tested first unless ?test=0)
 * DELETE /api/settings/mail — disconnect it
 *
 * The password field may be left blank to keep the stored one. It is never
 * sent back.
 */

import { json, readJson, route } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { disconnectMail, saveMailSettings, type MailSettingsInput } from "@/lib/mail/settings";

export const dynamic = "force-dynamic";

export const PUT = route(async (session, req) => {
  requireAdmin(session);
  const body = await readJson<MailSettingsInput & { test?: boolean }>(req);
  const result = await saveMailSettings(session, body, { test: body.test !== false });
  return json({ ok: true, ...result });
});

export const DELETE = route(async (session) => {
  requireAdmin(session);
  await disconnectMail(session);
  return json({ ok: true });
});
