/**
 * GET   /api/platform/tenants/:id — one agency and its users
 * PATCH /api/platform/tenants/:id — { name?, status?, allowUserManagement? }
 */

import { assertUuid, json, platformRoute, readJson } from "@/lib/api";
import { getAgency, updateAgency } from "@/lib/admin/accounts";

export const dynamic = "force-dynamic";


export const GET = platformRoute<{ id: string }>(async (_admin, _req, { params }) =>
  json(await getAgency(assertUuid(params.id)))
);

export const PATCH = platformRoute<{ id: string }>(async (admin, req, { params }) => {
  const body = await readJson<Record<string, unknown>>(req);
  return json(await updateAgency({ kind: "platform", id: admin.adminId, email: admin.email }, assertUuid(params.id), body));
});
