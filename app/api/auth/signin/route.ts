/**
 * POST /api/auth/signin — begin sign-in.
 *
 * With an identity provider configured this returns a redirect URL to it. In
 * development, with no provider, it signs in as a seeded user of the requested
 * tenant so the dashboard is usable. The development path is refused outright
 * in production, so a missing OIDC configuration locks everyone out rather than
 * letting everyone in.
 */

import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db, withTenant } from "@/lib/db/client";
import { tenants, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { cookieOptions, newClaims, serializeSession, SESSION_COOKIE } from "@/lib/auth/cookie";
import { devSignInAllowed } from "@/lib/auth/session";
import { authorizeUrl, isConfigured, pkce } from "@/lib/auth/oidc";

export const dynamic = "force-dynamic";

const PKCE_COOKIE = "certflow_oidc";

export async function POST(req: Request) {
  try {
    if (isConfigured()) {
      const { verifier, challenge, state } = pkce();
      const url = await authorizeUrl(challenge, state);
      const res = NextResponse.json({ redirect: url });
      // Short-lived, and never readable by script.
      res.cookies.set(PKCE_COOKIE, JSON.stringify({ verifier, state }), {
        ...cookieOptions(),
        maxAge: 600,
        sameSite: "lax", // the provider redirects back cross-site
      });
      return res;
    }

    if (!devSignInAllowed()) {
      return NextResponse.json(
        { error: "No identity provider configured. Set OIDC_ISSUER and related variables." },
        { status: 503 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as { tenant?: string; email?: string };
    const slug = body.tenant || process.env.DEV_TENANT_SLUG || "whittington";

    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug));
    if (!tenant) {
      return NextResponse.json({ error: `No tenant "${slug}". Run: npm run db:seed` }, { status: 404 });
    }

    const candidates = await db
      .select()
      .from(users)
      .where(eq(users.tenantId, tenant.id))
      .orderBy(asc(users.email));
    const user = body.email ? candidates.find((u) => u.email === body.email) : candidates[0];
    if (!user) return NextResponse.json({ error: "No such user." }, { status: 404 });
    if (user.status !== "active") {
      return NextResponse.json({ error: "This account is not active." }, { status: 403 });
    }

    await withTenant(tenant.id, async (tx) => {
      await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await audit(tx, {
        tenantId: tenant.id,
        actorUserId: user.id,
        action: "auth.signin",
        subjectType: "user",
        subjectId: user.id,
        after: { method: "dev" },
        ip: req.headers.get("x-forwarded-for"),
        userAgent: req.headers.get("user-agent"),
      });
    });

    const res = NextResponse.json({
      user: { email: user.email, name: user.name, role: user.role },
    });
    res.cookies.set(
      SESSION_COOKIE,
      await serializeSession(newClaims(user.id, tenant.id)),
      cookieOptions()
    );
    return res;
  } catch (err) {
    console.error("[auth/signin]", err);
    return NextResponse.json({ error: "Sign-in failed." }, { status: 500 });
  }
}
