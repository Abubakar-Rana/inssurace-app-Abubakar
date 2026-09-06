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

export async function middleware(req: NextRequest) {
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
  matcher: ["/", "/certificate/:path*"],
};
