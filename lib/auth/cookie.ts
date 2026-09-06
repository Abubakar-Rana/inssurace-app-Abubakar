/**
 * Signed session cookies.
 *
 * The session is stateless: the cookie carries the claims and an HMAC over
 * them, so no round trip is needed to identify the caller. What it does NOT
 * carry is authority — `requireSession` re-reads the user row on every request,
 * so disabling an account or changing a role takes effect immediately rather
 * than at the next sign-in. That is the revocation path that matters; a
 * `sessions` table would additionally allow "sign out everywhere", and is the
 * upgrade to make when someone asks for it.
 *
 * The value is signed, not encrypted — it holds an id and an expiry, nothing
 * secret. Tampering is what we defend against, and the HMAC does that.
 *
 * Uses Web Crypto rather than node:crypto so the same code runs in the Edge
 * runtime, where middleware.ts needs it. That makes signing async; callers
 * await it.
 */

export const SESSION_COOKIE = "certflow_session";

/** Sessions are short by design; re-authentication is cheap with an IdP. */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface SessionClaims {
  /** user id */
  sub: string;
  tenantId: string;
  /** issued at, epoch seconds */
  iat: number;
  /** expires at, epoch seconds */
  exp: number;
}

let keyPromise: Promise<CryptoKey> | null = null;

function hmacKey(): Promise<CryptoKey> {
  keyPromise ??= (async () => {
    const value = process.env.SESSION_SECRET;
    if (!value || value.length < 32) {
      throw new Error(
        "SESSION_SECRET is missing or too short (need >= 32 chars). Generate one with:\n" +
          "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\""
      );
    }
    return crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(value),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
  })();
  return keyPromise;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function sign(payload: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(payload));
  return toBase64Url(new Uint8Array(sig));
}

/** Constant-time compare — a short-circuiting `===` leaks the signature. */
function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function serializeSession(claims: SessionClaims): Promise<string> {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  return `${payload}.${await sign(payload)}`;
}

/** Returns null for anything malformed, mis-signed, or expired. */
export async function parseSession(value: string | undefined): Promise<SessionClaims | null> {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;

  const payload = value.slice(0, dot);

  let provided: Uint8Array;
  let expected: Uint8Array;
  try {
    provided = fromBase64Url(value.slice(dot + 1));
    expected = fromBase64Url(await sign(payload));
  } catch {
    return null;
  }
  if (!safeEqual(provided, expected)) return null;

  let claims: SessionClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
  } catch {
    return null;
  }

  if (typeof claims?.sub !== "string" || typeof claims?.tenantId !== "string") return null;
  if (typeof claims.exp !== "number" || claims.exp <= Math.floor(Date.now() / 1000)) return null;

  return claims;
}

export function newClaims(userId: string, tenantId: string): SessionClaims {
  const now = Math.floor(Date.now() / 1000);
  return { sub: userId, tenantId, iat: now, exp: now + SESSION_TTL_SECONDS };
}

/** Cookie attributes. `sameSite: strict` is our primary CSRF defence — a
 *  cross-site form post simply arrives without the cookie. */
export function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
