/**
 * GET  /api/platform/tenants — every agency, with account metadata only
 * POST /api/platform/tenants — create an agency and its first admin
 *
 * The response to POST carries the admin's temporary password. It is the only
 * time it exists in readable form; the console shows it once.
 */

import { json, platformRoute, readJson } from "@/lib/api";
import { createAgency, listAgencies, type CreateAgencyInput } from "@/lib/admin/accounts";

export const dynamic = "force-dynamic";

export const GET = platformRoute(async () => json({ tenants: await listAgencies() }));

export const POST = platformRoute(async (admin, req) => {
  const body = await readJson<CreateAgencyInput>(req);
  const created = await createAgency({ kind: "platform", id: admin.adminId, email: admin.email }, body);
  return json(created, 201);
});
