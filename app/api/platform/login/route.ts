/**
 * POST /api/platform/login — Nestnic console sign-in.
 *
 * Same rules as agency sign-in (one generic failure message, equal cost for
 * unknown accounts, lockout after five failures) but a separate table and a
 * separate, shorter-lived cookie. See lib/auth/platform.ts.
 */

import { NextResponse } from "next/server";
import { ServiceError } from "@/lib/certificate/service";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { platformAdmins } from "@/db/schema";
import { checkOrigin } from "@/lib/api";
import { PLATFORM_COOKIE, platformCookieOptions, platformCookieValue } from "@/lib/auth/platform";
import { burnVerifyTime, isLocked, lockoutAfterFailure, verifyPassword } from "@/lib/auth/password";

export const dynamic = "force-dynamic";

const WRONG = "Email or password is incorrect.";

export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });

    const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.email, email));
    if (!admin) {
      await burnVerifyTime(password);
      return NextResponse.json({ error: WRONG }, { status: 401 });
    }
    if (isLocked(admin.lockedUntil)) {
      return NextResponse.json({ error: "Too many attempts. Wait 15 minutes and try again." }, { status: 429 });
    }
    if (!(await verifyPassword(password, admin.passwordHash))) {
      await db.update(platformAdmins).set(lockoutAfterFailure(admin.failedLogins)).where(eq(platformAdmins.id, admin.id));
      console.warn(`[platform] failed sign-in for ${email} from ${req.headers.get("x-forwarded-for") ?? "?"}`);
      return NextResponse.json({ error: WRONG }, { status: 401 });
    }
    if (admin.status !== "active") {
      return NextResponse.json({ error: "This account is disabled." }, { status: 403 });
    }

    await db
      .update(platformAdmins)
      .set({ lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null })
      .where(eq(platformAdmins.id, admin.id));
    console.log(`[platform] ${email} signed in from ${req.headers.get("x-forwarded-for") ?? "?"}`);

    const res = NextResponse.json({ mustChangePassword: admin.mustChangePassword });
    res.cookies.set(PLATFORM_COOKIE, await platformCookieValue(admin.id), platformCookieOptions());
    return res;
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[platform/login]", err);
    return NextResponse.json({ error: "Sign-in failed." }, { status: 500 });
  }
}
