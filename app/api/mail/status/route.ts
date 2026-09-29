/**
 * GET /api/mail/status — is this agency's inbox connected, and is it sending
 * automatically? For every signed-in user: the dashboard uses it for the
 * "connect your inbox" onboarding banner, the sidebar's mailbox readout, and
 * the auto-send indicator in the top bar. Account address and switches only.
 */

import { eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { tenants } from "@/db/schema";
import { json, route } from "@/lib/api";
import { getMailSettingsView } from "@/lib/mail/settings";

export const dynamic = "force-dynamic";

export const GET = route(async (session) => {
  const [view, agency] = await Promise.all([
    getMailSettingsView(session.tenantId, session.tenantSlug),
    withTenant(session.tenantId, async (tx) => {
      const [row] = await tx.select({ autoSend: tenants.autoSend }).from(tenants).where(eq(tenants.id, session.tenantId));
      return row;
    }),
  ]);

  return json({
    configured: view.configured,
    provider: view.provider,
    account: view.configured ? view.emailAddress : null,
    lastError: view.lastError,
    canConnect: session.role === "admin",
    // Shown in the top bar, so everyone on the team can see at a glance that
    // certificates are going out without a reviewer.
    autoSend: agency?.autoSend ?? false,
  });
});
