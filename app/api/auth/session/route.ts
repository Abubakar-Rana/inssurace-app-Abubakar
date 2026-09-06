/**
 * GET    /api/auth/session — who am I (200 with the user, or 401)
 * DELETE /api/auth/session — sign out
 */

import { NextResponse } from "next/server";
import { withTenant } from "@/lib/db/client";
import { audit } from "@/lib/audit";
import { getSession } from "@/lib/auth/session";
import { isConfigured } from "@/lib/auth/oidc";
import { cookieOptions, SESSION_COOKIE } from "@/lib/auth/cookie";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null, oidc: isConfigured() }, { status: 401 });
  }
  return NextResponse.json({
    user: {
      email: session.email,
      name: session.name,
      role: session.role,
      tenant: session.tenantSlug,
    },
  });
}

export async function DELETE(req: Request) {
  const session = await getSession();

  if (session) {
    await withTenant(session.tenantId, (tx) =>
      audit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "auth.signout",
        subjectType: "user",
        subjectId: session.userId,
        ip: req.headers.get("x-forwarded-for"),
        userAgent: req.headers.get("user-agent"),
      })
    );
  }

  const res = NextResponse.json({ ok: true });
  // Overwrite rather than delete, so the browser cannot keep serving a cached
  // value from an earlier response.
  res.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  return res;
}
