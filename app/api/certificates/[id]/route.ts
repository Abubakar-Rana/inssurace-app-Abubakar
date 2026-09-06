/**
 * GET   /api/certificates/:id — fetch the snapshot for review
 * PATCH /api/certificates/:id — save reviewer edits (drafts only)
 */

import { json, readJson, route } from "@/lib/api";
import { requireWrite } from "@/lib/auth/session";
import { getCertificate, ServiceError, updateSnapshot } from "@/lib/certificate/service";
import type { Certificate } from "@/lib/certificate/types";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (session, _req, { params }) => {
  return json({ certificate: await getCertificate(session, params.id) });
});

export const PATCH = route<{ id: string }>(async (session, req, { params }) => {
  requireWrite(session);
  const body = await readJson<{ snapshot?: Certificate }>(req);
  if (!body.snapshot || typeof body.snapshot !== "object") {
    throw new ServiceError("Expected a `snapshot` object.");
  }
  return json({ certificate: await updateSnapshot(session, params.id, body.snapshot) });
});
