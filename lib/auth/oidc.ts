/**
 * OpenID Connect sign-in (Security L3).
 *
 * Identity lives at the agency's identity provider — Google Workspace or Entra
 * — which is why db/schema.ts has no password column. Nothing here to phish,
 * leak, or reset, and MFA is enforced by the IdP where the agency has already
 * configured it to their own standard. That is also the honest answer when an
 * agency asks how CertFlow handles passwords: it doesn't have any.
 *
 * Authorization Code flow with PKCE. Even though this is a confidential client
 * with a secret, PKCE costs nothing and closes code interception.
 *
 * CONFIGURE: set OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and
 * OIDC_REDIRECT_URI. Until then `isConfigured()` is false and the sign-in page
 * falls back to the development provider.
 */

import { createHash, randomBytes } from "node:crypto";

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface OidcClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
}

export function isConfigured(): boolean {
  return Boolean(
    process.env.OIDC_ISSUER &&
      process.env.OIDC_CLIENT_ID &&
      process.env.OIDC_CLIENT_SECRET &&
      process.env.OIDC_REDIRECT_URI
  );
}

export function config(): OidcConfig {
  if (!isConfigured()) throw new Error("OIDC is not configured.");
  return {
    issuer: process.env.OIDC_ISSUER!.replace(/\/$/, ""),
    clientId: process.env.OIDC_CLIENT_ID!,
    clientSecret: process.env.OIDC_CLIENT_SECRET!,
    redirectUri: process.env.OIDC_REDIRECT_URI!,
  };
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

let discovery: Promise<Discovery> | null = null;

export function discover(): Promise<Discovery> {
  discovery ??= fetch(`${config().issuer}/.well-known/openid-configuration`).then((r) => {
    if (!r.ok) throw new Error(`OIDC discovery failed (${r.status})`);
    return r.json();
  });
  return discovery;
}

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, state: randomBytes(16).toString("base64url") };
}

export async function authorizeUrl(challenge: string, state: string): Promise<string> {
  const { authorization_endpoint } = await discover();
  const cfg = config();
  const url = new URL(authorization_endpoint);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  // Least privilege: `openid` makes this OIDC (without it the provider returns
  // no id_token), and `email` is how the callback finds the user row. We do NOT
  // request `profile` — users are pre-provisioned, so their display name is
  // already in our database and reading Google's copy would gain nothing.
  // It also keeps "See your personal info" off the consent screen, which is one
  // fewer permission an agency's security review has to weigh.
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Exchange the code for an id_token and read its claims.
 *
 * The token comes straight from the provider's token endpoint over TLS, so the
 * signature is not re-verified here — that is the standard allowance for the
 * confidential code flow. An id_token accepted from anywhere else (an implicit
 * flow, a client-supplied token) WOULD have to be verified against the JWKS,
 * so do not reuse this function for that.
 */
export async function exchangeCode(code: string, verifier: string): Promise<OidcClaims> {
  const { token_endpoint } = await discover();
  const cfg = config();

  const res = await fetch(token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);

  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new Error("Provider returned no id_token.");

  const payload = JSON.parse(
    Buffer.from(id_token.split(".")[1], "base64url").toString("utf8")
  ) as Record<string, unknown>;

  const email = typeof payload.email === "string" ? payload.email : "";
  if (!email) throw new Error("Provider returned no email claim.");

  return {
    sub: String(payload.sub ?? ""),
    email: email.toLowerCase(),
    emailVerified: payload.email_verified === true,
  };
}
