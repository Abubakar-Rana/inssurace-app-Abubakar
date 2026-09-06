/**
 * GET /api/auth/callback — the identity provider returns here.
 *
 * Users are NOT created on the fly. An account must already exist for that
 * email in a tenant, provisioned by an agency admin. Auto-provisioning would
 * mean anyone with a Google account could sign in and land in someone's tenant;
 * requiring an existing row keeps membership an explicit decision.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, withTenant } from "@/lib/db/client";
import { users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { cookieOptions, newClaims, serializeSession, SESSION_COOKIE } from "@/lib/auth/cookie";
import { exchangeCode, isConfigured } from "@/lib/auth/oidc";

export const dynamic = "force-dynamic";

const PKCE_COOKIE = "certflow_oidc";

function fail(reason: string) {
  return NextResponse.redirect(
    new URL(`/signin?error=${encodeURIComponent(reason)}`, process.env.APP_URL || "http://localhost:3000")
  );
}

export async function GET(req: Request) {
  try {
    if (!isConfigured()) return fail("Sign-in is not configured.");

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return fail("Missing authorization code.");

    const raw = req.headers
      .get("cookie")
      ?.split("; ")
      .find((c) => c.startsWith(`${PKCE_COOKIE}=`))
      ?.slice(PKCE_COOKIE.length + 1);
    if (!raw) return fail("Sign-in session expired. Try again.");

    const stored = JSON.parse(decodeURIComponent(raw)) as { verifier: string; state: string };
    // Binds this callback to the request that started it — without the state
    // check an attacker can complete a login in the victim's browser.
    if (stored.state !== state) return fail("Invalid state.");

    const claims = await exchangeCode(code, stored.verifier);
    if (!claims.emailVerified) return fail("Your provider has not verified this email address.");

    const [user] = await db.select().from(users).where(eq(users.email, claims.email));
    if (!user) return fail("No CertFlow account for that address. Ask your administrator.");
    if (user.status !== "active") return fail("This account is not active.");

    await withTenant(user.tenantId, async (tx) => {
      await tx
        .update(users)
        .set({ lastLoginAt: new Date(), externalSubject: claims.sub })
        .where(eq(users.id, user.id));
      await audit(tx, {
        tenantId: user.tenantId,
        actorUserId: user.id,
        action: "auth.signin",
        subjectType: "user",
        subjectId: user.id,
        after: { method: "oidc", issuer: process.env.OIDC_ISSUER },
        ip: req.headers.get("x-forwarded-for"),
        userAgent: req.headers.get("user-agent"),
      });
    });

    const res = NextResponse.redirect(new URL("/", process.env.APP_URL || "http://localhost:3000"));
    res.cookies.set(
      SESSION_COOKIE,
      await serializeSession(newClaims(user.id, user.tenantId)),
      cookieOptions()
    );
    res.cookies.delete(PKCE_COOKIE);
    return res;
  } catch (err) {
    console.error("[auth/callback]", err);
    return fail("Sign-in failed.");
  }
}
