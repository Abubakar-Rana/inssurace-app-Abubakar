/**
 * POST /api/requests/:id/certificate — assemble a draft from the database.
 *
 * Takes no body. Every value on the resulting certificate comes from policy,
 * vehicle and party rows; there is deliberately no way for a caller to supply
 * a limit or a policy number here.
 */

import { json, route } from "@/lib/api";
import { requireWrite } from "@/lib/auth/session";
import { generateForRequest } from "@/lib/certificate/service";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(async (session, _req, { params }) => {
  requireWrite(session);
  const cert = await generateForRequest(session, params.id);
  return json({ certificate: cert }, 201);
});
