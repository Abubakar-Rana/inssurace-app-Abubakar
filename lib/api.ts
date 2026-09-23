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
import { AuthError, ForbiddenError, requireSession, type Session } from "@/lib/auth/session";
import { ServiceError } from "@/lib/certificate/service";
import { requirePlatformAdmin, type PlatformSession } from "@/lib/auth/platform";

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
export function checkOrigin(req: Request): void {
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
      // A temporary password is a credential somebody else chose and has seen.
      // Until the user replaces it, the only thing it opens is the screen that
      // replaces it (app/api/auth/password, which does not go through here).
      if (session.mustChangePassword) {
        throw new ForbiddenError("Set a new password before continuing.");
      }
      return await handler(session, req, ctx);
    } catch (err) {
      if (err instanceof AuthError) {
        return NextResponse.json({ error: err.message }, { status: 401 });
      }
      if (err instanceof ForbiddenError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      if (err instanceof ServiceError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      console.error("[api]", err);
      return NextResponse.json({ error: "Internal error." }, { status: 500 });
    }
  };
}

/**
 * Same contract as `route()`, for the Nestnic console: a platform-admin
 * session instead of an agency one. Kept separate so no handler can be
 * reached with the wrong kind of session by mistake.
 */
export function platformRoute<T>(
  handler: (admin: PlatformSession, req: Request, ctx: { params: T }) => Promise<Response>
) {
  return async (req: Request, ctx: { params: T }): Promise<Response> => {
    try {
      checkOrigin(req);
      const admin = await requirePlatformAdmin();
      return await handler(admin, req, ctx);
    } catch (err) {
      if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
      if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      console.error("[platform api]", err);
      return NextResponse.json({ error: "Internal error." }, { status: 500 });
    }
  };
}

/** Route ids are UUIDs; anything else is simply not found (and never reaches a query). */
export function assertUuid(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new ServiceError("Not found.", 404);
  }
  return id;
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
