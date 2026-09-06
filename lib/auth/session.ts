/**
 * Who is making this request, and which agency's data may they see.
 *
 * Every route handler goes through `requireSession()`, and nothing below it
 * ever accepts a tenant id from the client — the tenant comes from the signed
 * session cookie and is handed to `withTenant()`, which pins row-level security
 * for the transaction.
 *
 * The cookie is only a claim of identity. Authority is re-read from the
 * database on every request, so a suspended account or a downgraded role takes
 * effect at once instead of at the next sign-in.
 *
 * Sign-in itself is delegated to the agency's identity provider — see
 * lib/auth/oidc.ts for why there is no password column.
 */

import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants, users } from "@/db/schema";
import { parseSession, SESSION_COOKIE } from "./cookie";

export interface Session {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  email: string;
  name: string;
  role: "admin" | "reviewer" | "readonly";
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Development sign-in, used only when no identity provider is configured.
 *
 * Refuses to run in production, so shipping without configuring OIDC fails
 * closed rather than letting anyone in as an admin.
 */
export function devSignInAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Resolve the caller, or null when not signed in. */
export async function getSession(): Promise<Session | null> {
  const claims = await parseSession(cookies().get(SESSION_COOKIE)?.value);
  if (!claims) return null;

  const [row] = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      status: users.status,
      tenantId: users.tenantId,
      tenantSlug: tenants.slug,
    })
    .from(users)
    .innerJoin(tenants, eq(users.tenantId, tenants.id))
    .where(and(eq(users.id, claims.sub), eq(users.tenantId, claims.tenantId)));

  // The cookie names a user who no longer exists, moved tenant, or was
  // suspended. Treat all three as signed out.
  if (!row || row.status !== "active") return null;

  return {
    tenantId: row.tenantId,
    tenantSlug: row.tenantSlug,
    userId: row.userId,
    email: row.email,
    name: row.name,
    role: row.role,
  };
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new AuthError("Not signed in.");
  return session;
}

/** Throws unless the session may modify data. */
export function requireWrite(session: Session): void {
  if (session.role === "readonly") {
    throw new AuthError("This account has read-only access.");
  }
}
