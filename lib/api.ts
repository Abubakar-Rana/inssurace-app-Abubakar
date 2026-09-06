/**
 * Shared plumbing for route handlers.
 *
 * Every handler runs through `route()`, which resolves the session before the
 * body is touched and turns thrown errors into status codes. Two consequences
 * worth keeping: an unauthenticated request never reaches a query, and an
 * unexpected exception returns a generic message rather than leaking a database
 * error — stack traces and constraint names are reconnaissance.
 */

import { NextResponse } from "next/server";
import { AuthError, requireSession, type Session } from "@/lib/auth/session";
import { ServiceError } from "@/lib/certificate/service";

export type Handler<T> = (session: Session, req: Request, ctx: { params: T }) => Promise<Response>;

const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * Reject cross-site mutations.
 *
 * `sameSite: strict` on the session cookie is the primary defence — a
 * cross-site request simply arrives unauthenticated. This is the belt to that
 * pair of braces, and it also covers the case where a future change relaxes the
 * cookie to `lax` for an OAuth redirect.
 */
function checkOrigin(req: Request): void {
  if (!MUTATING.has(req.method)) return;

  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients omit it; the cookie still guards

  // Compare against the host the browser actually connected to, not only the
  // configured APP_URL. Browsers set Origin themselves, so a cross-site page
  // cannot forge it to match Host — while pinning to APP_URL alone rejects
  // every legitimate write whenever the app is reached by any other name or
  // port (a preview deploy, a second domain, a non-default dev port).
  const host = req.headers.get("host");
  const allowed = [
    process.env.APP_URL,
    host && `http://${host}`,
    host && `https://${host}`,
  ].filter(Boolean) as string[];

  const strip = (u: string) => u.replace(/\/$/, "").toLowerCase();
  if (!allowed.some((a) => strip(a) === strip(origin))) {
    throw new ServiceError("Cross-origin request rejected.", 403);
  }
}

export function route<T>(handler: Handler<T>) {
  return async (req: Request, ctx: { params: T }): Promise<Response> => {
    try {
      checkOrigin(req);
      const session = await requireSession();
      return await handler(session, req, ctx);
    } catch (err) {
      if (err instanceof AuthError) {
        return NextResponse.json({ error: err.message }, { status: 401 });
      }
      if (err instanceof ServiceError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      console.error("[api]", err);
      return NextResponse.json({ error: "Internal error." }, { status: 500 });
    }
  };
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/** Parses a JSON body, rejecting anything that is not an object. */
export async function readJson<T>(req: Request): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ServiceError("Request body must be JSON.");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ServiceError("Request body must be a JSON object.");
  }
  return body as T;
}
