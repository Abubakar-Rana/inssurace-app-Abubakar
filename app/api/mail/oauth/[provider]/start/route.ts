/**
 * GET /api/mail/oauth/:provider/start — opened in the "Connect your inbox"
 * pop-up. Sends the agency admin to Google's or Microsoft's own consent screen.
 *
 * Agency admins only. A GET, because it is a top-level navigation in a pop-up;
 * it is still not forgeable from another site, since the session cookie is
 * SameSite=Strict and simply is not sent on a cross-site navigation.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { beginAuthorization, isOAuthProvider, MailAuthError } from "@/lib/mail/oauth";
import { oauthResultPage, STATE_COOKIE, stateCookieOptions } from "@/lib/mail/oauthPage";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { provider: string } }) {
  if (!isOAuthProvider(params.provider)) return oauthResultPage({ ok: false, message: "Unknown mail provider." }, 404);

  const session = await getSession();
  if (!session) return oauthResultPage({ ok: false, message: "Your CertFlow session has ended. Sign in again, then connect." }, 401);
  if (session.mustChangePassword) {
    return oauthResultPage({ ok: false, message: "Set your own password first, then connect the inbox." }, 403);
  }
  if (session.role !== "admin") {
    return oauthResultPage({ ok: false, message: "Only an agency admin can connect the inbox." }, 403);
  }

  try {
    const { url, cookieValue } = beginAuthorization(params.provider, session.tenantId, session.userId);
    const res = NextResponse.redirect(url);
    res.cookies.set(STATE_COOKIE, cookieValue, stateCookieOptions());
    return res;
  } catch (err) {
    const message = err instanceof MailAuthError ? err.message : "Could not start the connection.";
    if (!(err instanceof MailAuthError)) console.error("[mail oauth start]", err);
    return oauthResultPage({ ok: false, message }, 500);
  }
}
