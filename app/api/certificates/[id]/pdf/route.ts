/**
 * GET /api/certificates/:id/pdf — the rendered document.
 *
 * Rendered from the stored snapshot, never from live policy data: an approved
 * certificate must reprint exactly as it was certified, even after the policy
 * behind it has renewed.
 */

import { route } from "@/lib/api";
import { getCertificate } from "@/lib/certificate/service";
import { certificateFileName, renderCertificatePdf } from "@/lib/certificate/render";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (session, _req, { params }) => {
  const record = await getCertificate(session, params.id);
  const bytes = await renderCertificatePdf(record.snapshot);

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${certificateFileName(record.snapshot)}"`,
      // Certificates carry insured details; keep them out of shared caches.
      "Cache-Control": "private, no-store",
    },
  });
});
