/**
 * GET  /api/users — this agency's users (admins only)
 * POST /api/users — add one; only where Nestnic allows the agency to manage its own users
 */

import { json, readJson, route } from "@/lib/api";
import { requireAdmin, requireUserManagement } from "@/lib/auth/session";
import { createUser, listUsers } from "@/lib/admin/accounts";

export const dynamic = "force-dynamic";


export const GET = route(async (session) => {
  requireAdmin(session);
  return json({ users: await listUsers(session.tenantId), canManageUsers: session.canManageUsers });
});

export const POST = route(async (session, req) => {
  requireUserManagement(session);
  const body = await readJson<{ name: unknown; email: unknown; role: unknown }>(req);
  const created = await createUser({ kind: "agency", id: session.userId, email: session.email }, session.tenantId, body);
  return json(created, 201);
});
