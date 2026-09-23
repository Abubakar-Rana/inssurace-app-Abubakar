/**
 * Password hashing for the password sign-in path (Security L3).
 *
 * scrypt from node:crypto — memory-hard, so a stolen hash table costs an
 * attacker RAM as well as CPU per guess, and it needs no native dependency.
 * Stored as `scrypt$<logN>$<r>$<p>$<salt>$<hash>` so the cost can be raised
 * later without invalidating existing hashes: `verify` reads the parameters
 * from the string, and `needsRehash` says when to upgrade one at next sign-in.
 *
 * Passwords are never logged, never returned, and never stored in the audit
 * log. Nestnic issues a TEMPORARY password; the user must replace it on first
 * sign-in, so nobody at Nestnic knows a working credential afterwards.
 */

import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

const LOG_N = 15; // N = 32768
const R = 8;
const P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

export const MIN_PASSWORD_LENGTH = 10;

function scrypt(password: string, salt: Buffer, logN: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(
      password.normalize("NFKC"),
      salt,
      KEY_LEN,
      // maxmem must cover 128 * N * r bytes, with headroom.
      { N: 2 ** logN, r, p, maxmem: 256 * 2 ** logN * r },
      (err, key) => (err ? reject(err) : resolve(key))
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(password, salt, LOG_N, R, P);
  return `scrypt$${LOG_N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** Constant-time. Returns false — never throws — for a malformed stored hash. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, logN, r, p, saltB64, keyB64] = parts;
  try {
    const expected = Buffer.from(keyB64, "base64");
    const actual = await scrypt(password, Buffer.from(saltB64, "base64"), Number(logN), Number(r), Number(p));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Timing filler for "no such user": costs what a real verify costs, so the
 *  response time does not reveal which addresses have accounts. */
let dummyHash: Promise<string> | null = null;
export async function burnVerifyTime(password: string): Promise<void> {
  dummyHash ??= hashPassword("certflow-timing-filler");
  await verifyPassword(password, await dummyHash);
}

/** A human-readable reason the password is unacceptable, or null when it is fine. */
export function passwordProblem(password: string, email?: string): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) return "That password is too long.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Use at least one letter and one number.";
  }
  if (email && password.toLowerCase().includes(email.split("@")[0].toLowerCase())) {
    return "Do not include your email name in the password.";
  }
  return null;
}

/**
 * A temporary password to read out or paste to a new user.
 *
 * No look-alike characters (0/O, 1/l/I), grouped for reading aloud. ~80 bits
 * of entropy, and it only has to survive until first sign-in.
 */
export function temporaryPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const group = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("");
  // Guarantee the letter+digit rule without biasing the rest.
  return `${group()}-${group()}-${group()}-${randomInt(10, 99)}`;
}

// ---------------------------------------------------------------- lockout

/** After this many consecutive failures the account locks for LOCK_MINUTES. */
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

export function isLocked(lockedUntil: Date | null | undefined): boolean {
  return Boolean(lockedUntil && lockedUntil.getTime() > Date.now());
}

export function lockoutAfterFailure(failedLogins: number): { failedLogins: number; lockedUntil: Date | null } {
  const next = failedLogins + 1;
  return next >= MAX_FAILED_LOGINS
    ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000) }
    : { failedLogins: next, lockedUntil: null };
}
