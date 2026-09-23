/**
 * Page-level gate: an unauthenticated browser is sent to /signin.
 *
 * This is convenience, NOT the security boundary. Middleware only checks that a
 * well-formed, unexpired cookie is present — it cannot reach the database from
 * the edge runtime, so it cannot tell whether the account still exists or has
 * been suspended. Every API route independently calls `requireSession()`, which
 * does verify against the database. Deleting this file would degrade the user
 * experience, not the security of the data.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { parseSession, SESSION_COOKIE } from "@/lib/auth/cookie";

/** Must match PLATFORM_COOKIE in lib/auth/platform.ts (not imported: that module needs Node). */
const PLATFORM_COOKIE = "certflow_platform";

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // The public marketing page. Someone already signed in has no use for it,
  // so they land on their inbox instead of the sales pitch.
  if (path === "/" || path === "/welcome") {
    const signedIn = await parseSession(req.cookies.get(SESSION_COOKIE)?.value);
    const url = req.nextUrl.clone();
    url.search = "";
    if (signedIn) {
      url.pathname = "/inbox";
      return NextResponse.redirect(url);
    }
    if (path === "/welcome") {
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // The Nestnic console has its own sign-in and its own cookie. An agency
  // session never opens it, and a console session never opens the agency app.
  if (path.startsWith("/admin")) {
    if (path === "/admin/signin") return NextResponse.next();
    const admin = await parseSession(req.cookies.get(PLATFORM_COOKIE)?.value, "platform");
    if (admin) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = "/admin/signin";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const claims = await parseSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (claims) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/signin";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Pages only. API routes guard themselves and must return 401 as JSON rather
  // than redirect, and /signin itself has to stay reachable.
  matcher: [
    "/",
    "/welcome",
    "/inbox",
    "/certificate/:path*",
    "/certificates",
    "/settings/:path*",
    "/account/:path*",
    "/admin/:path*",
    "/admin",
  ],
};
