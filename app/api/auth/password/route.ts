/**
 * POST /api/auth/password — replace your own password.
 *
 * The one route a user with a temporary password can reach (it does not go
 * through `route()`, which refuses them everything else). Requires the current
 * password even then: a session left open on a shared screen should not be
 * enough to take the account over.
 */

import { NextResponse } from "next/server";
import { ServiceError } from "@/lib/certificate/service";
import { eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getSession } from "@/lib/auth/session";
import { checkOrigin } from "@/lib/api";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { current?: unknown; next?: unknown };
    const current = typeof body.current === "string" ? body.current : "";
    const next = typeof body.next === "string" ? body.next : "";

    const problem = passwordProblem(next, session.email);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    if (next === current) {
      return NextResponse.json({ error: "Choose a password different from the current one." }, { status: 400 });
    }

    return await withTenant(session.tenantId, async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, session.userId));
      // An IdP-only account has no password to replace; it has nothing to change here.
      if (!user?.passwordHash || !(await verifyPassword(current, user.passwordHash))) {
        return NextResponse.json({ error: "Your current password is incorrect." }, { status: 400 });
      }

      await tx
        .update(users)
        .set({ passwordHash: await hashPassword(next), mustChangePassword: false, failedLogins: 0, lockedUntil: null })
        .where(eq(users.id, user.id));
      await audit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "auth.password_changed",
        subjectType: "user",
        subjectId: session.userId,
        ip: req.headers.get("x-forwarded-for"),
        userAgent: req.headers.get("user-agent"),
      });
      return NextResponse.json({ ok: true });
    });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[auth/password]", err);
    return NextResponse.json({ error: "Could not change the password." }, { status: 500 });
  }
}
