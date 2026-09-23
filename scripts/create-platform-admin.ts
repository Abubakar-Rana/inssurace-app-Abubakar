/**
 * Create (or reset) a Nestnic platform admin — the only way the first one can
 * exist, because the console itself requires one to sign in.
 *
 *   npm run admin:create -- --email you@nestnic.com --name "Your Name"
 *   npm run admin:create -- --email you@nestnic.com --reset
 *
 * Prints a TEMPORARY password once. It must be changed at first sign-in. Run it
 * from a trusted machine: whoever can run this with the production
 * DATABASE_URL already controls the platform, which is why it is a script and
 * not a web page.
 */

import "@/lib/env";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { platformAdmins } from "@/db/schema";
import { hashPassword, temporaryPassword } from "@/lib/auth/password";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  const reset = process.argv.includes("--reset");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('Usage: npm run admin:create -- --email you@nestnic.com --name "Your Name" [--reset]');
  }

  const temp = temporaryPassword();
  const passwordHash = await hashPassword(temp);
  const [existing] = await db.select().from(platformAdmins).where(eq(platformAdmins.email, email));

  if (existing) {
    if (!reset) throw new Error(`${email} already exists. Add --reset to issue a new temporary password.`);
    await db
      .update(platformAdmins)
      .set({ passwordHash, mustChangePassword: true, failedLogins: 0, lockedUntil: null, status: "active" })
      .where(eq(platformAdmins.id, existing.id));
    console.log(`\nReset ${email}.`);
  } else {
    if (!name) throw new Error("--name is required when creating an admin.");
    await db.insert(platformAdmins).values({ email, name, passwordHash, mustChangePassword: true });
    console.log(`\nCreated Nestnic admin ${email}.`);
  }

  console.log(`Temporary password: ${temp}`);
  console.log(`Sign in at ${process.env.APP_URL ?? "http://localhost:3000"}/admin/signin — you will be asked to change it.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
