/** POST /api/settings/mail/test — try the entered settings without saving them. */

import { withTenant } from "@/lib/db/client";
import { json, readJson, route } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { tenantMailSettings } from "@/db/schema";
import { openSecret } from "@/lib/crypto/tenantSecrets";
import { testMailConfig, toConfig, type MailSettingsInput } from "@/lib/mail/settings";

export const dynamic = "force-dynamic";

export const POST = route(async (session, req) => {
  requireAdmin(session);
  const body = await readJson<MailSettingsInput>(req);
  // A blank password field means "the one already saved".
  const stored = await withTenant(session.tenantId, async (tx) => {
    const [row] = await tx.select().from(tenantMailSettings);
    return row?.passwordEnc ? openSecret(tx, session.tenantId, row.passwordEnc) : null;
  });
  return json(await testMailConfig(await toConfig(body, stored)));
});
