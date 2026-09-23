/**
 * GET /api/mail/oauth/:provider/callback — Google or Microsoft returns here.
 *
 * The CertFlow session cookie is SameSite=Strict, so it does NOT arrive on this
 * cross-site redirect. Identity comes from the signed, single-use state cookie
 * set by /start instead, and is then re-checked against the database: the
 * person must still be an active admin of an active agency. The `state`
 * parameter must match the cookie's nonce, which ties this callback to the
 * pop-up that started it (no login CSRF, no swapped codes).
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/lib/db/client";
import { tenants, users } from "@/db/schema";
import { completeAuthorization, isOAuthProvider, MailAuthError, openState, providerLabel } from "@/lib/mail/oauth";
import { saveOAuthConnection } from "@/lib/mail/settings";
import { oauthResultPage, STATE_COOKIE } from "@/lib/mail/oauthPage";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { provider: string } }): Promise<NextResponse> {
  if (!isOAuthProvider(params.provider)) return oauthResultPage({ ok: false, message: "Unknown mail provider." }, 404);
  const provider = params.provider;
  const url = new URL(req.url);

  const state = openState(cookies().get(STATE_COOKIE)?.value);
  if (!state || state.provider !== provider || url.searchParams.get("state") !== state.nonce) {
    return oauthResultPage({ ok: false, message: "This connection attempt expired or was not started here. Please click Connect again." }, 400);
  }

  // The user said no, or closed the consent screen.
  if (url.searchParams.get("error")) {
    return oauthResultPage({ ok: false, message: `${providerLabel(provider)} access was not granted, so nothing was connected.` });
  }
  const code = url.searchParams.get("code");
  if (!code) return oauthResultPage({ ok: false, message: "No authorization code came back. Please try again." }, 400);

  // Still an active admin of an active agency? (Suspensions take effect here too.)
  const [who] = await db
    .select({ role: users.role, status: users.status, tenantStatus: tenants.status })
    .from(users)
    .innerJoin(tenants, eq(users.tenantId, tenants.id))
    .where(and(eq(users.id, state.userId), eq(users.tenantId, state.tenantId)));
  if (!who || who.status !== "active" || who.tenantStatus !== "active" || who.role !== "admin") {
    return oauthResultPage({ ok: false, message: "Only an active agency admin can connect the inbox." }, 403);
  }

  try {
    const connection = await completeAuthorization(provider, code, state);
    await saveOAuthConnection({ tenantId: state.tenantId, userId: state.userId }, provider, connection);
    return oauthResultPage({ ok: true, message: `${connection.account} is now connected. New certificate requests will appear in CertFlow within seconds.` });
  } catch (err) {
    if (err instanceof MailAuthError) return oauthResultPage({ ok: false, message: err.message }, 400);
    console.error("[mail oauth callback]", (err as Error).message);
    return oauthResultPage({ ok: false, message: "Something went wrong while connecting. Please try again." }, 500);
  }
}
