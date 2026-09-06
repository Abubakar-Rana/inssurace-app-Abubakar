/**
 * Security L1 — envelope encryption with per-tenant data keys.
 *
 *   master KEK (env / KMS, never in the DB)
 *      └─ unwraps ─> tenant DEK (stored in tenant_keys as ciphertext)
 *            └─ encrypts ─> individual column values
 *
 * WHY NOT "one env var per agency", as originally specified: 500 agencies would
 * need 500 environment variables and onboarding a customer would require a
 * redeploy. This preserves the guarantee that matters — each agency has its own
 * key, and the only secret in the environment is the master KEK. A stolen
 * database yields nothing but noise.
 *
 * Cipher is AES-256-GCM, which authenticates as well as encrypts: tampering
 * with stored ciphertext fails the auth tag instead of silently decrypting to
 * garbage the way AES-CBC would.
 *
 * Crypto-shredding (Security L6): destroy a tenant's DEK and every value they
 * own becomes permanently unrecoverable. That is how "delete all my data"
 * coexists with a 7-year immutable audit log.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = "v1";

/** Reads the master KEK lazily so importing this module never throws at build
 *  time — only actual crypto operations require the secret to be present. */
function masterKek(): Buffer {
  const raw = process.env.CERTFLOW_MASTER_KEK;
  if (!raw) {
    throw new Error(
      "CERTFLOW_MASTER_KEK is not set. Generate one with:\n" +
        `  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`CERTFLOW_MASTER_KEK must decode to ${KEY_BYTES} bytes, got ${key.length}.`);
  }
  return key;
}

/** `v1.<base64(iv | tag | ciphertext)>` */
function seal(key: Buffer, plaintext: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64")}`;
}

function open(key: Buffer, packed: string): Buffer {
  const [version, payload] = packed.split(".", 2);
  if (version !== VERSION || !payload) {
    throw new Error(`Unsupported ciphertext format: ${version ?? "(empty)"}`);
  }
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

// ------------------------------------------------------------------ tenant keys

/** Mint a new tenant data key. Returns the plaintext DEK (hold it only in
 *  memory) and the wrapped form to persist in `tenant_keys.wrapped_dek`. */
export function createTenantKey(): { dek: Buffer; wrappedDek: string } {
  const dek = randomBytes(KEY_BYTES);
  return { dek, wrappedDek: seal(masterKek(), dek) };
}

export function unwrapDek(wrappedDek: string): Buffer {
  return open(masterKek(), wrappedDek);
}

// ------------------------------------------------------------------ field crypto

export function encryptField(dek: Buffer, plaintext: string): string {
  return seal(dek, Buffer.from(plaintext, "utf8"));
}

export function decryptField(dek: Buffer, packed: string): string {
  return open(dek, packed).toString("utf8");
}

/**
 * Blind index for encrypted columns that must still support exact lookup
 * (e.g. "find the client with this FEIN").
 *
 * Deterministic HMAC keyed by the tenant DEK: the same input always yields the
 * same index, so it is searchable, but the value cannot be reversed and indexes
 * are not comparable across tenants. Normalisation is deliberate — FEINs are
 * written as 12-3456789 or 123456789 and must collide to the same index.
 *
 * Only for high-entropy identifiers. Never blind-index something guessable like
 * a surname; an attacker with the index could confirm guesses.
 */
export function blindIndex(dek: Buffer, value: string): string {
  const normalised = value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return createHmac("sha256", dek).update(normalised).digest("hex");
}

export function blindIndexEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
