/**
 * Minimal NowCerts API client — read-only use of a few endpoints.
 *
 * Endpoints and shapes are from the NowCerts Postman collection and the
 * published help pages (https://api.nowcerts.com/Help). They are NOT yet
 * verified against a live account; field reads go through `pick()`, which is
 * case-insensitive, because the help pages show PascalCase while the Postman
 * samples use camelCase.
 *
 * SECURITY
 *  - The base URL is fixed. Agencies supply credentials, never a URL, so this
 *    cannot be pointed at anything else.
 *  - Access tokens live in process memory only, per agency, and are never
 *    written anywhere. Credentials are passed in by the caller, already
 *    decrypted for this call, and not retained.
 *  - We only ever READ. Nothing here calls an Insert/Update endpoint.
 *
 * Uses node:https rather than fetch because GET /api/Policy/Coverages takes a
 * JSON body, which fetch refuses to send on a GET.
 */

import { request } from "node:https";
import { createHash } from "node:crypto";

const HOST = "api.nowcerts.com";
const CLIENT_ID = "ngAuthApp";
const TIMEOUT_MS = 60_000;
const MAX_BYTES = 50 * 1024 * 1024;

export class NowCertsError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "NowCertsError";
    this.status = status;
  }
}

interface RawResponse {
  status: number;
  body: string;
}

function send(method: string, path: string, headers: Record<string, string>, body?: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: HOST, port: 443, path, method, headers: { Accept: "application/json", ...headers }, timeout: TIMEOUT_MS },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            req.destroy(new NowCertsError("NowCerts response was unexpectedly large."));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    req.on("timeout", () => req.destroy(new NowCertsError("NowCerts did not respond in time.")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------- auth

interface Token {
  accessToken: string;
  expiresAt: number;
}

/** Keyed by agency + a hash of the username, so a changed login gets a fresh token. */
const tokens = new Map<string, Token>();

export interface Credentials {
  tenantId: string;
  username: string;
  password: string;
}

function tokenKey(c: Credentials): string {
  return `${c.tenantId}:${createHash("sha256").update(c.username).digest("hex").slice(0, 16)}`;
}

async function token(c: Credentials, fresh = false): Promise<string> {
  const key = tokenKey(c);
  const cached = tokens.get(key);
  if (!fresh && cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;

  const form = new URLSearchParams({
    grant_type: "password",
    username: c.username,
    password: c.password,
    client_id: CLIENT_ID,
  }).toString();
  const res = await send("POST", "/api/token", {
    "Content-Type": "application/x-www-form-urlencoded",
    "Content-Length": String(Buffer.byteLength(form)),
  }, form);

  if (res.status === 400 || res.status === 401) {
    tokens.delete(key);
    throw new NowCertsError("NowCerts rejected the username or password.", res.status);
  }
  if (res.status !== 200) throw new NowCertsError(`NowCerts sign-in failed (HTTP ${res.status}).`, res.status);

  const body = JSON.parse(res.body) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new NowCertsError("NowCerts returned no access token.");
  const t = { accessToken: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  tokens.set(key, t);
  return t.accessToken;
}

export function forgetToken(c: Credentials): void {
  tokens.delete(tokenKey(c));
}

// ---------------------------------------------------------------- calls

export async function call<T = unknown>(
  c: Credentials,
  method: "GET" | "POST",
  path: string,
  opts: { query?: Record<string, string>; json?: unknown } = {}
): Promise<T> {
  const qs = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : "";
  const body = opts.json === undefined ? undefined : JSON.stringify(opts.json);

  for (let attempt = 0; attempt < 2; attempt++) {
    const headers: Record<string, string> = { Authorization: `Bearer ${await token(c, attempt > 0)}` };
    if (body) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(body));
    }
    const res = await send(method, `/api/${path}${qs}`, headers, body);
    if (res.status === 401 && attempt === 0) continue; // token expired early; retry once with a fresh one
    if (res.status < 200 || res.status >= 300) {
      throw new NowCertsError(`NowCerts ${path} failed (HTTP ${res.status}).`, res.status);
    }
    return (res.body ? JSON.parse(res.body) : null) as T;
  }
  throw new NowCertsError("NowCerts refused the session.", 401);
}

/** OData list results arrive either as a bare array or as `{ value: [...] }`. */
export function rows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const value = (data as { value?: unknown })?.value;
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/** Page through an OData list. Capped, so a runaway result cannot exhaust memory. */
export async function listAll(
  c: Credentials,
  path: string,
  query: Record<string, string>,
  { pageSize = 500, max = 20_000 } = {}
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let skip = 0; skip < max; skip += pageSize) {
    const page = rows(
      await call(c, "GET", path, { query: { ...query, $top: String(pageSize), $skip: String(skip), $count: "true" } })
    );
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

/** Case-insensitive field read: `pick(row, "InsuredMC_Number")` also finds `insuredMC_Number`. */
export function pick(obj: Record<string, unknown> | null | undefined, ...names: string[]): unknown {
  if (!obj) return undefined;
  for (const name of names) {
    if (name in obj) return obj[name];
    const lower = name.toLowerCase();
    for (const key of Object.keys(obj)) if (key.toLowerCase() === lower) return obj[key];
  }
  return undefined;
}

export function text(obj: Record<string, unknown> | null | undefined, ...names: string[]): string {
  const v = pick(obj, ...names);
  return v === null || v === undefined ? "" : String(v).trim();
}
