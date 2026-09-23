/** POST /api/platform/tenants/:id/users — Nestnic adds a user to an agency. */

import { assertUuid, json, platformRoute, readJson } from "@/lib/api";
import { createUser } from "@/lib/admin/accounts";

export const dynamic = "force-dynamic";

export const POST = platformRoute<{ id: string }>(async (admin, req, { params }) => {
  const body = await readJson<{ name: unknown; email: unknown; role: unknown }>(req);
  const created = await createUser({ kind: "platform", id: admin.adminId, email: admin.email }, assertUuid(params.id), body);
  return json(created, 201);
});
