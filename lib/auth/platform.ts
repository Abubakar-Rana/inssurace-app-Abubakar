/**
 * Nestnic platform-admin sessions — the people who create agencies and their
 * users. Separate from agency sessions in every way that matters:
 *
 *  - its own table (`platform_admins`), never a row in `users`
 *  - its own cookie, signed with `aud: "platform"`, so neither kind of cookie
 *    is accepted in place of the other (lib/auth/cookie.ts)
 *  - a shorter lifetime: this console can create admins for any agency, so a
 *    forgotten open tab should not stay powerful for a working day
 *
 * A platform admin has NO path to an agency's certificates, requests or
 * credentials through this console. It manages accounts and switches; the
 * data stays behind each tenant's own session and row-level security.
 */

import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { platformAdmins } from "@/db/schema";
import { parseSession, serializeSession, type SessionClaims } from "./cookie";
import { AuthError, ForbiddenError } from "./session";

export const PLATFORM_COOKIE = "certflow_platform";
export const PLATFORM_TTL_SECONDS = 2 * 60 * 60;

export interface PlatformSession {
  adminId: string;
  email: string;
  name: string;
  mustChangePassword: boolean;
}

export function platformClaims(adminId: string): SessionClaims {
  const now = Math.floor(Date.now() / 1000);
  return { sub: adminId, tenantId: "platform", iat: now, exp: now + PLATFORM_TTL_SECONDS, aud: "platform" };
}

export async function platformCookieValue(adminId: string): Promise<string> {
  return serializeSession(platformClaims(adminId));
}

export function platformCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: PLATFORM_TTL_SECONDS,
  };
}

/** Authority is re-read from the database every time, like agency sessions. */
export async function getPlatformSession(): Promise<PlatformSession | null> {
  const claims = await parseSession(cookies().get(PLATFORM_COOKIE)?.value, "platform");
  if (!claims || !/^[0-9a-f-]{36}$/i.test(claims.sub)) return null;
  const [row] = await db.select().from(platformAdmins).where(eq(platformAdmins.id, claims.sub));
  if (!row || row.status !== "active") return null;
  return { adminId: row.id, email: row.email, name: row.name, mustChangePassword: row.mustChangePassword };
}

/** For every console route except sign-in and password change. */
export async function requirePlatformAdmin(): Promise<PlatformSession> {
  const session = await getPlatformSession();
  if (!session) throw new AuthError("Not signed in to the Nestnic console.");
  if (session.mustChangePassword) throw new ForbiddenError("Set a new password before continuing.");
  return session;
}
