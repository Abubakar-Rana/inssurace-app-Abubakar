/**
 * Poll the Gmail inbox once and report what happened.
 *
 *   npm run gmail:poll              # last 30 days, up to 25 messages
 *   npm run gmail:poll -- --days 2  # narrower window
 *   npm run gmail:poll -- --limit 5
 *
 * Read-only against the mailbox: nothing is marked seen, moved, or deleted.
 * Re-running is safe — already-stored messages are skipped.
 */

import "@/lib/env";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/db/schema";
import { ingestGmail } from "@/lib/gmail/ingest";

function arg(name: string): number | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = Number(process.argv[i + 1]);
  return Number.isFinite(value) ? value : undefined;
}

async function main() {
  const slug = process.env.DEV_TENANT_SLUG ?? "whittington";
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug));
  if (!tenant) throw new Error(`No tenant "${slug}". Run: npm run db:seed`);

  const days = arg("days") ?? 30;
  const limit = arg("limit") ?? 25;

  console.log(`polling ${process.env.GMAIL_USER} — last ${days} day(s), max ${limit}\n`);

  const result = await ingestGmail(tenant.id, {
    since: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
    limit,
  });

  console.log(`fetched     ${result.fetched}`);
  console.log(`coi         ${result.candidates}`);
  console.log(`not a coi   ${result.skipped}`);
  console.log(`new         ${result.inserted}`);
  console.log(`follow-ups  ${result.followUps}`);
  console.log(`drafted     ${result.generated}`);
  console.log(`already had ${result.duplicates}`);

  if (result.requests.length) {
    console.log("\nresults:");
    for (const r of result.requests) {
      const subject = (r.subject ?? "(no subject)").slice(0, 48).padEnd(50);
      const outcome = r.decision === "matched" ? `-> ${r.clientName}` : "-> needs a human";
      console.log(`  ${subject} ${r.decision.padEnd(10)} ${outcome}`);
    }
  }

  console.log(
    `\n${result.matched} matched automatically, ${result.needsMatch} routed to a human.`
  );
  // Print what was passed over. The filter is a heuristic, so the only honest
  // way to run it is with its misses on screen.
  if (result.ignored.length) {
    console.log("\nnot certificate requests (never stored):");
    for (const m of result.ignored) {
      console.log(`  ${(m.subject ?? "(no subject)").slice(0, 48).padEnd(50)} ${m.reason}`);
    }
    console.log("\n(if a real request is in that list, set GMAIL_INGEST_ALL=1 and re-run)");
  }

  if (result.inserted === 0 && result.candidates > 0) {
    console.log("(nothing new — every request was already ingested)");
  }
  if (result.fetched === 0) {
    console.log("(no mail in the window — send a test email and widen --days if needed)");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
