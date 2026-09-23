/** POST /api/platform/tenants/:id/users/:userId/reset — issue a new temporary password. */

import { assertUuid, json, platformRoute } from "@/lib/api";
import { resetPassword } from "@/lib/admin/accounts";

export const dynamic = "force-dynamic";

export const POST = platformRoute<{ id: string; userId: string }>(async (admin, _req, { params }) =>
  json(await resetPassword({ kind: "platform", id: admin.adminId, email: admin.email }, assertUuid(params.id), assertUuid(params.userId)))
);
