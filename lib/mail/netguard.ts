/**
 * Outbound-connection guard for hosts an agency types in (Security L5).
 *
 * Agencies configure their own IMAP/SMTP servers. Without a check, a mail
 * "host" of 127.0.0.1, 10.0.0.5 or 169.254.169.254 turns CertFlow into a probe
 * of our own private network and cloud metadata service (SSRF) — and the
 * "test connection" button reports back what it found. So:
 *
 *  - the name is resolved and EVERY address it resolves to must be public
 *  - only TLS ports are allowed (IMAP 993; SMTP 465 or 587 with STARTTLS
 *    required), so credentials never cross the network in clear text
 *
 * Checked when settings are saved and again before each new connection, since
 * DNS can change after the fact. Results are cached briefly so the watcher's
 * reconnects do not each cost a lookup.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const IMAP_PORTS = [993];
export const SMTP_PORTS = [465, 587];

export class UnsafeHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeHostError";
  }
}

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast + reserved
  );
}

function isPrivateV6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) return true; // link-local
  if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique local
  if (v.startsWith("ff")) return true; // multicast
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateV4(mapped[1]) : false;
}

export function isPrivateAddress(ip: string): boolean {
  return isIP(ip) === 6 ? isPrivateV6(ip) : isPrivateV4(ip);
}

const cache = new Map<string, number>();
const CACHE_MS = 10 * 60 * 1000;

/** Throws UnsafeHostError unless `host` is a DNS name that resolves only to public addresses. */
export async function assertPublicHost(host: string): Promise<void> {
  const name = host.trim().toLowerCase();
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(name)) {
    throw new UnsafeHostError(`"${host}" is not a valid mail server name (use a name like imap.gmail.com).`);
  }
  const hit = cache.get(name);
  if (hit && hit > Date.now()) return;

  let addresses: { address: string }[];
  try {
    addresses = await lookup(name, { all: true });
  } catch {
    throw new UnsafeHostError(`Could not find the mail server "${host}". Check the spelling.`);
  }
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new UnsafeHostError(`"${host}" points to a private network address and cannot be used.`);
  }
  cache.set(name, Date.now() + CACHE_MS);
}

export function assertPort(port: number, allowed: number[], what: string): void {
  if (!allowed.includes(port)) {
    throw new UnsafeHostError(`${what} port must be ${allowed.join(" or ")} (encrypted connections only).`);
  }
}
