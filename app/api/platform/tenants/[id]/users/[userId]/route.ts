/** PATCH /api/platform/tenants/:id/users/:userId — { name?, role?, status? } */

import { assertUuid, json, platformRoute, readJson } from "@/lib/api";
import { updateUser } from "@/lib/admin/accounts";

export const dynamic = "force-dynamic";

export const PATCH = platformRoute<{ id: string; userId: string }>(async (admin, req, { params }) => {
  const body = await readJson<Record<string, unknown>>(req);
  return json(
    await updateUser({ kind: "platform", id: admin.adminId, email: admin.email }, assertUuid(params.id), assertUuid(params.userId), body)
  );
});
