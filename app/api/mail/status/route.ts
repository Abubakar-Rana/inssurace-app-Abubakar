/**
 * GET /api/mail/status — is this agency's inbox connected? For every signed-in
 * user: the dashboard uses it for the "connect your inbox" onboarding banner
 * and the sidebar's mailbox readout. Account address and health only.
 */

import { json, route } from "@/lib/api";
import { getMailSettingsView } from "@/lib/mail/settings";

export const dynamic = "force-dynamic";

export const GET = route(async (session) => {
  const view = await getMailSettingsView(session.tenantId, session.tenantSlug);
  return json({
    configured: view.configured,
    provider: view.provider,
    account: view.configured ? view.emailAddress : null,
    lastError: view.lastError,
    canConnect: session.role === "admin",
  });
});
