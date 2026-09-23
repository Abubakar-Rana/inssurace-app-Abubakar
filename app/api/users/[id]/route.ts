/** PATCH /api/users/:id — { name?, role?, status? }, where Nestnic allows it. */

import { assertUuid, json, readJson, route } from "@/lib/api";
import { requireUserManagement } from "@/lib/auth/session";
import { updateUser } from "@/lib/admin/accounts";

export const dynamic = "force-dynamic";

export const PATCH = route<{ id: string }>(async (session, req, { params }) => {
  requireUserManagement(session);
  const body = await readJson<Record<string, unknown>>(req);
  return json(
    await updateUser({ kind: "agency", id: session.userId, email: session.email }, session.tenantId, assertUuid(params.id), body)
  );
});
