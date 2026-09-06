/**
 * POST /api/certificates/:id/approve — a human signs off.
 *
 * The server re-renders the PDF and stores the digest of those bytes. That is
 * what makes "approved" mean something specific: the recorded hash identifies
 * the exact document, so a later delivery can be checked against what was
 * actually reviewed rather than merely against a database row.
 *
 * Approval does NOT send anything. Delivery is a separate, explicit action.
 */

import { json, route } from "@/lib/api";
import { requireWrite } from "@/lib/auth/session";
import { approve, getCertificate } from "@/lib/certificate/service";
import { renderCertificatePdf, sha256 } from "@/lib/certificate/render";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(async (session, _req, { params }) => {
  requireWrite(session);

  const record = await getCertificate(session, params.id);
  const bytes = await renderCertificatePdf(record.snapshot);

  return json({ certificate: await approve(session, params.id, sha256(bytes)) });
});
