/**
 * Environment loading for standalone scripts (migrate, seed, workers).
 *
 * Next.js loads .env.local automatically, but scripts run under tsx do not —
 * they would silently see an undefined DATABASE_URL and fail with a confusing
 * error. Import this first in any script that runs outside Next.
 *
 * Precedence matches Next's: .env.local wins over .env, so real secrets live in
 * the gitignored file and .env holds only safe defaults.
 */

import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.local and fill it in.`);
  }
  return value;
}
