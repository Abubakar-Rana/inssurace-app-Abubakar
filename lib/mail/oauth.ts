/**
 * "Connect your inbox" — OAuth for Google (Gmail) and Microsoft (Outlook/365).
 *
 * An agency admin clicks Connect, the provider's own consent pop-up asks them
 * to allow CertFlow to READ and SEND mail, and we keep a refresh token for that
 * agency. No passwords are typed into CertFlow at all.
 *
 * SECURITY
 *  - Least privilege. Google: gmail.readonly + gmail.send. Microsoft: Mail.Read
 *    + Mail.Send. Nothing that can delete, move or label mail. The granted
 *    scopes are checked on return, because both consent screens let a user
 *    untick a permission.
 *  - Authorization Code + PKCE, with a `state` that is HMAC-signed, expires in
 *    10 minutes, and names the agency, the admin and the provider. The
 *    callback re-checks in the database that the admin still is one.
 *  - The refresh token is sealed with the agency's own data key. Access tokens
 *    live in process memory only, never in the database or a log.
 *  - Endpoints are fixed per provider — nothing an agency types becomes a URL.
 *  - Microsoft rotates refresh tokens on every use; the new one is sealed and
 *    saved immediately, or the connection would die at the next refresh.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { tenantMailSettings } from "@/db/schema";
import { openSecret, sealSecret } from "@/lib/crypto/tenantSecrets";

export type OAuthProvider = "google" | "microsoft";
export const OAUTH_PROVIDERS: OAuthProvider[] = ["google", "microsoft"];

interface ProviderSpec {
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  scopes: string[];
  /** Scopes that MUST come back granted, or the connection is refused. */
  required: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
  extraAuthParams: Record<string, string>;
}

const SPECS: Record<OAuthProvider, ProviderSpec> = {
  google: {
    label: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    scopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ],
    required: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    // offline + consent: the only way Google reliably returns a refresh token.
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "false" },
  },
  microsoft: {
    label: "Microsoft",
    // "common": work/school accounts from any organisation, and personal Outlook.com.
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: [
      "openid",
      "email",
      "offline_access",
      "https://graph.microsoft.com/Mail.Read",
      "https://graph.microsoft.com/Mail.Send",
    ],
    required: ["mail.read", "mail.send"],
    clientIdEnv: "MICROSOFT_OAUTH_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_OAUTH_CLIENT_SECRET",
    extraAuthParams: { prompt: "select_account", response_mode: "query" },
  },
};

export function providerLabel(p: OAuthProvider): string {
  return SPECS[p].label;
}

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return value === "google" || value === "microsoft";
}

/** Whether Nestnic has registered CertFlow with this provider (env set). */
export function providerConfigured(p: OAuthProvider): boolean {
  return Boolean(process.env[SPECS[p].clientIdEnv] && process.env[SPECS[p].clientSecretEnv]);
}

function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function redirectUri(p: OAuthProvider): string {
  return `${appUrl()}/api/mail/oauth/${p}/callback`;
}

// ---------------------------------------------------------------- http (swappable for tests)

type Fetch = typeof fetch;
let http: Fetch = (...args) => fetch(...args);
/** Tests only: replace the network. */
export function setHttpForTests(impl: Fetch | null): void {
  http = impl ?? ((...args) => fetch(...args));
}
export function httpFetch(...args: Parameters<Fetch>): ReturnType<Fetch> {
  return http(...args);
}

export class MailAuthError extends Error {
  /** True when the grant is gone for good (revoked, password changed) — only reconnecting fixes it. */
  needsReconnect: boolean;
  constructor(message: string, needsReconnect = false) {
    super(message);
    this.name = "MailAuthError";
    this.needsReconnect = needsReconnect;
  }
}

// ---------------------------------------------------------------- state

export interface OAuthState {
  tenantId: string;
  userId: string;
  provider: OAuthProvider;
  nonce: string;
  verifier: string;
  exp: number;
}

function stateKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET is missing or too short.");
  // Domain-separated from session cookies: a state value can never be replayed as a session.
  return createHmac("sha256", secret).update("certflow:mail-oauth-state:v1").digest();
}

export function sealState(s: OAuthState): string {
  const body = Buffer.from(JSON.stringify(s)).toString("base64url");
  const mac = createHmac("sha256", stateKey()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function openState(value: string | undefined | null): OAuthState | null {
  if (!value) return null;
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", stateKey()).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
    if (!isOAuthProvider(s.provider) || typeof s.exp !== "number" || s.exp < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

/** Start: returns the provider URL to open, and the state to keep in a cookie. */
export function beginAuthorization(p: OAuthProvider, tenantId: string, userId: string, loginHint?: string) {
  const spec = SPECS[p];
  const clientId = process.env[spec.clientIdEnv];
  if (!clientId || !providerConfigured(p)) {
    throw new MailAuthError(`${spec.label} sign-in is not set up on this CertFlow server yet. Contact Nestnic support.`);
  }
  const verifier = randomBytes(32).toString("base64url");
  const state: OAuthState = {
    tenantId,
    userId,
    provider: p,
    nonce: randomBytes(16).toString("base64url"),
    verifier,
    exp: Date.now() + 10 * 60 * 1000,
  };
  const url = new URL(spec.authorizeUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri(p));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", spec.scopes.join(" "));
  url.searchParams.set("state", state.nonce);
  url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
  url.searchParams.set("code_challenge_method", "S256");
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  for (const [k, v] of Object.entries(spec.extraAuthParams)) url.searchParams.set(k, v);
  return { url: url.toString(), cookieValue: sealState(state) };
}

// ---------------------------------------------------------------- tokens

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(p: OAuthProvider, params: Record<string, string>): Promise<TokenResponse> {
  const spec = SPECS[p];
  const res = await http(spec.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: process.env[spec.clientIdEnv] ?? "",
      client_secret: process.env[spec.clientSecretEnv] ?? "",
      ...params,
    }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || body.error) {
    const gone = body.error === "invalid_grant" || body.error === "interaction_required";
    // Provider error codes only — descriptions can echo request data.
    throw new MailAuthError(
      gone
        ? `${spec.label} access for this inbox was removed or has expired. Reconnect it in Settings → Email.`
        : `${spec.label} refused the request (${body.error ?? res.status}).`,
      gone
    );
  }
  return body;
}

/** The account the user actually connected, from the id_token the token endpoint returned over TLS. */
function accountFromIdToken(idToken: string | undefined): string {
  if (!idToken) return "";
  try {
    const claims = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const email = (claims.email ?? claims.preferred_username ?? claims.upn ?? "") as string;
    return String(email).toLowerCase();
  } catch {
    return "";
  }
}

export function missingScopes(p: OAuthProvider, granted: string | undefined): string[] {
  const have = new Set((granted ?? "").split(/\s+/).map((s) => s.toLowerCase().replace(/^https:\/\/graph\.microsoft\.com\//, "")));
  return SPECS[p].required.filter((r) => !have.has(r.toLowerCase()));
}

export interface Connection {
  account: string;
  refreshToken: string;
  scopes: string;
}

/** Callback: trade the code for tokens and check what was granted. */
export async function completeAuthorization(p: OAuthProvider, code: string, state: OAuthState): Promise<Connection> {
  const t = await tokenRequest(p, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(p),
    code_verifier: state.verifier,
  });
  if (!t.refresh_token) {
    throw new MailAuthError(`${SPECS[p].label} did not grant ongoing access. Please try Connect again and accept all permissions.`);
  }
  const missing = missingScopes(p, t.scope);
  if (missing.length) {
    throw new MailAuthError(
      "CertFlow needs permission to both read and send email. Please click Connect again and tick every box on the permissions screen."
    );
  }
  const account = accountFromIdToken(t.id_token);
  if (!account) throw new MailAuthError(`${SPECS[p].label} did not tell us which mailbox was connected. Please try again.`);
  if (t.access_token) remember(state.tenantId, p, t.access_token, t.expires_in);
  return { account, refreshToken: t.refresh_token, scopes: t.scope ?? SPECS[p].scopes.join(" ") };
}

// ---------------------------------------------------------------- access tokens (memory only)

const cache = new Map<string, { token: string; expiresAt: number }>();
const refreshing = new Map<string, Promise<string>>();

function remember(tenantId: string, p: OAuthProvider, token: string, expiresIn = 3600) {
  cache.set(`${tenantId}:${p}`, { token, expiresAt: Date.now() + expiresIn * 1000 });
}

/** Drop the cached access token — after a 401, or when the mailbox is disconnected. */
export function forgetAccessToken(tenantId: string): void {
  for (const key of [...cache.keys()]) if (key.startsWith(`${tenantId}:`)) cache.delete(key);
}

/**
 * A valid access token for this agency's connected inbox, refreshing when
 * needed. Concurrent callers share one refresh — two parallel Microsoft
 * refreshes would each rotate the token and one would save a dead one.
 */
export async function accessTokenFor(tenantId: string, p: OAuthProvider): Promise<string> {
  const key = `${tenantId}:${p}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const running = refreshing.get(key);
  if (running) return running;

  const run = (async () => {
    const sealed = await withTenant(tenantId, async (tx) => {
      const [row] = await tx.select().from(tenantMailSettings).where(eq(tenantMailSettings.tenantId, tenantId));
      if (!row?.oauthRefreshTokenEnc || row.provider !== p) return null;
      return openSecret(tx, tenantId, row.oauthRefreshTokenEnc);
    });
    if (!sealed) throw new MailAuthError("This inbox is not connected. Connect it in Settings → Email.", true);

    const t = await tokenRequest(p, { grant_type: "refresh_token", refresh_token: sealed });
    if (!t.access_token) throw new MailAuthError(`${SPECS[p].label} returned no access token.`);
    remember(tenantId, p, t.access_token, t.expires_in);

    if (t.refresh_token && t.refresh_token !== sealed) {
      // Rotation (Microsoft always, Google sometimes): persist before anything else can use the old one.
      await withTenant(tenantId, async (tx) =>
        tx
          .update(tenantMailSettings)
          .set({ oauthRefreshTokenEnc: await sealSecret(tx, tenantId, t.refresh_token!) })
          .where(eq(tenantMailSettings.tenantId, tenantId))
      );
    }
    return t.access_token;
  })().finally(() => refreshing.delete(key));

  refreshing.set(key, run);
  return run;
}

/** Best effort: tell the provider to cancel the grant. Microsoft has no revoke endpoint for this. */
export async function revokeGrant(p: OAuthProvider, refreshToken: string): Promise<boolean> {
  const url = SPECS[p].revokeUrl;
  if (!url) return false;
  try {
    const res = await http(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}
