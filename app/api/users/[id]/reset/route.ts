/** POST /api/users/:id/reset — issue a new temporary password, where Nestnic allows it. */

import { assertUuid, json, route } from "@/lib/api";
import { requireUserManagement } from "@/lib/auth/session";
import { resetPassword } from "@/lib/admin/accounts";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(async (session, _req, { params }) => {
  requireUserManagement(session);
  return json(await resetPassword({ kind: "agency", id: session.userId, email: session.email }, session.tenantId, assertUuid(params.id)));
});
