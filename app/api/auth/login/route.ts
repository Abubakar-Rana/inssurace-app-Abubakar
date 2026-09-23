/**
 * POST /api/auth/login — email + password sign-in.
 *
 * The password path for agencies without Google Workspace or Entra. It ends in
 * exactly the same signed cookie as the OIDC callback, so nothing past this
 * point knows or cares how the user got in.
 *
 * - Accounts are never created here. Nestnic, or an agency admin Nestnic has
 *   allowed to, creates them with a temporary password.
 * - One message for every failure ("email or password is incorrect"), and the
 *   same scrypt cost whether or not the account exists, so the endpoint does
 *   not confirm which addresses have accounts.
 * - Five consecutive failures lock the account for 15 minutes.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, withTenant } from "@/lib/db/client";
import { tenants, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { checkOrigin } from "@/lib/api";
import { ServiceError } from "@/lib/certificate/service";
import { cookieOptions, newClaims, serializeSession, SESSION_COOKIE } from "@/lib/auth/cookie";
import {
  burnVerifyTime,
  isLocked,
  lockoutAfterFailure,
  verifyPassword,
} from "@/lib/auth/password";

export const dynamic = "force-dynamic";

const WRONG = "Email or password is incorrect.";

export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) {
      return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
    }

    const [row] = await db
      .select({ user: users, tenantStatus: tenants.status })
      .from(users)
      .innerJoin(tenants, eq(users.tenantId, tenants.id))
      .where(eq(users.email, email));

    if (!row || !row.user.passwordHash) {
      await burnVerifyTime(password);
      return NextResponse.json({ error: WRONG }, { status: 401 });
    }
    const { user } = row;

    if (isLocked(user.lockedUntil)) {
      return NextResponse.json(
        { error: "Too many attempts. Wait 15 minutes and try again." },
        { status: 429 }
      );
    }

    const ok = await verifyPassword(password, user.passwordHash);
    const meta = {
      ip: req.headers.get("x-forwarded-for"),
      userAgent: req.headers.get("user-agent"),
    };

    if (!ok) {
      const next = lockoutAfterFailure(user.failedLogins);
      await withTenant(user.tenantId, async (tx) => {
        await tx.update(users).set(next).where(eq(users.id, user.id));
        await audit(tx, {
          tenantId: user.tenantId,
          actorUserId: user.id,
          action: next.lockedUntil ? "auth.locked" : "auth.signin_failed",
          subjectType: "user",
          subjectId: user.id,
          after: { method: "password" },
          ...meta,
        });
      });
      return NextResponse.json({ error: WRONG }, { status: 401 });
    }

    // Right password, but the account or the agency is switched off. Said
    // plainly: the person has proved who they are, so there is nothing to hide.
    if (user.status !== "active" || row.tenantStatus !== "active") {
      return NextResponse.json(
        { error: "This account is disabled. Contact your administrator." },
        { status: 403 }
      );
    }

    await withTenant(user.tenantId, async (tx) => {
      await tx
        .update(users)
        .set({ lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null })
        .where(eq(users.id, user.id));
      await audit(tx, {
        tenantId: user.tenantId,
        actorUserId: user.id,
        action: "auth.signin",
        subjectType: "user",
        subjectId: user.id,
        after: { method: "password" },
        ...meta,
      });
    });

    const res = NextResponse.json({
      user: { email: user.email, name: user.name, role: user.role },
      mustChangePassword: user.mustChangePassword,
    });
    res.cookies.set(
      SESSION_COOKIE,
      await serializeSession(newClaims(user.id, user.tenantId)),
      cookieOptions()
    );
    return res;
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[auth/login]", err);
    return NextResponse.json({ error: "Sign-in failed." }, { status: 500 });
  }
}
