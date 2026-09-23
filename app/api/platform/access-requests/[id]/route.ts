/**
 * POST /api/platform/access-requests/:id — approve or decline an enquiry.
 *
 * Approving creates the agency and its first admin exactly as the New Agency
 * form does, and returns the one-time temporary password. Declining only marks
 * the row; nothing is emailed either way.
 */

import { assertUuid, json, platformRoute, readJson } from "@/lib/api";
import { ServiceError } from "@/lib/certificate/service";
import { createAgency } from "@/lib/admin/accounts";
import { listAccessRequests, markAccessRequest } from "@/lib/admin/accessRequests";

export const dynamic = "force-dynamic";

export const POST = platformRoute<{ id: string }>(async (admin, req, { params }) => {
  const id = assertUuid(params.id);
  const body = await readJson<{ action?: unknown; allowUserManagement?: unknown }>(req);
  const [enquiry] = (await listAccessRequests(undefined)).filter((r) => r.id === id);
  if (!enquiry) throw new ServiceError("Request not found.", 404);
  if (enquiry.status !== "new") throw new ServiceError(`This request was already ${enquiry.status}.`, 409);

  if (body.action === "decline") {
    await markAccessRequest(id, "declined", admin.adminId);
    return json({ ok: true });
  }
  if (body.action !== "approve") throw new ServiceError("Action must be approve or decline.");

  const created = await createAgency(
    { kind: "platform", id: admin.adminId, email: admin.email },
    {
      name: enquiry.agencyName,
      allowUserManagement: body.allowUserManagement === true,
      admin: { name: enquiry.contactName, email: enquiry.email },
    }
  );
  await markAccessRequest(id, "approved", admin.adminId, created.tenantId);
  return json(created, 201);
});
