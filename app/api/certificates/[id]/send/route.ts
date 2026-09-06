/**
 * GET  /api/certificates/:id/send — past deliveries for this certificate
 * POST /api/certificates/:id/send — email it as a reply to the original request
 *
 * POST is the only path in the system that sends anything outward, and it is
 * only ever reached by a human pressing a button. Nothing schedules it, and
 * approval does not trigger it.
 */

import { json, readJson, route } from "@/lib/api";
import { requireWrite } from "@/lib/auth/session";
import { deliverCertificate, listDeliveries } from "@/lib/certificate/deliver";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (session, _req, { params }) => {
  return json({ deliveries: await listDeliveries(session, params.id) });
});

export const POST = route<{ id: string }>(async (session, req, { params }) => {
  requireWrite(session);

  // `to` is optional: it defaults to whoever sent the request. The reviewer can
  // redirect it — compliance inboxes are often not the person who wrote in.
  const body = await readJson<{ to?: string }>(req).catch(() => ({}) as { to?: string });

  const result = await deliverCertificate(session, params.id, body.to?.trim() || undefined);
  return json({ delivery: result });
});
