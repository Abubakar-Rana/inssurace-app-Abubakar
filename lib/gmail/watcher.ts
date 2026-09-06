/**
 * Watch the mailbox continuously, so a request reaches the dashboard in
 * seconds without anybody pressing anything.
 *
 * ---------------------------------------------------------------------------
 * HOW IT DETECTS MAIL, AND WHY NOT BY POLLING EVERY FIVE SECONDS
 *
 * Reconnecting to Gmail every five seconds would mean roughly seventeen
 * thousand IMAP connections a day to be told, almost every time, that nothing
 * changed. Gmail rate-limits that, and it would be wasteful even if it did not.
 *
 * IMAP has a better mechanism. A connection can be parked in IDLE, and the
 * SERVER announces new mail on it. Detection is then push, not poll, and
 * arrives in well under a second on one connection that stays open.
 *
 * Two mechanisms run on ONE connection:
 *
 *   PRIMARY    the server announces mail on the idle connection; usually
 *              sub-second
 *   GUARANTEE  every few seconds that same connection is asked whether any
 *              higher message number exists. No reconnect and no downloads, so
 *              being told "no" is close to free — which is what makes a
 *              five-second ceiling affordable
 *
 * The watcher connection NEVER fetches anything itself. It only notices, then
 * calls the ordinary ingest path — the same one the manual command uses. That
 * keeps one tested route into the database instead of two.
 *
 * READ-ONLY, LIKE EVERY OTHER MAILBOX ACCESS. The folder is opened with
 * EXAMINE, so the server itself refuses any flag change.
 *
 * SINGLE PROCESS BY DESIGN. If this ever runs on several instances they would
 * each watch and each ingest. That is wasteful but harmless: the unique index
 * on (tenant, gmail_message_id) is what makes double ingestion a no-op, and it
 * is enforced by the database rather than by coordination between processes.
 * ---------------------------------------------------------------------------
 */

import { ImapFlow } from "imapflow";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/db/schema";
import { publish } from "@/lib/events";
import { gmailConfigFromEnv } from "./inbox";
import { ingestGmailShared } from "./ingest";

/**
 * How often the open connection is asked whether anything is new.
 *
 * This is the CEILING on how long a request can sit unseen. The announcement
 * path below is usually much faster; this is what happens when it is not.
 */
const CHECK_SECONDS = Number(process.env.GMAIL_CHECK_SECONDS ?? 2);

/** How far back a sweep looks. Cheap: already-seen messages are skipped. */
const LOOKBACK_DAYS = Number(process.env.GMAIL_WATCH_DAYS ?? 2);

/** Reconnection backoff, in seconds. Caps rather than growing without bound. */
const BACKOFF = [2, 5, 10, 30, 60];

/** Log every check. Noisy by design — for diagnosing a watcher that has gone quiet. */
const DEBUG = process.env.GMAIL_WATCH_DEBUG === "1";

let running = false;

/**
 * Start watching. Safe to call repeatedly — the second call does nothing.
 *
 * Never throws. A mailbox that cannot be reached must not stop the web server
 * from serving the dashboard; the reviewer can still work, and the connection
 * retries in the background.
 */
export function startWatching(): void {
  if (running) return;
  if (process.env.GMAIL_WATCH === "0") {
    console.log("[watcher] disabled by GMAIL_WATCH=0");
    return;
  }
  running = true;
  void watchLoop();
}

/**
 * Resolve which tenant this deployment mailbox belongs to.
 *
 * Read once per connection, not per check. That is fine in production, where a
 * tenant row outlives the process — but `npm run db:seed` DELETES and recreates
 * the tenant, so a watcher started before a reseed holds a dead id and every
 * ingest fails on a foreign key. Restart the watcher after seeding.
 */
async function resolveTenantId(): Promise<string | null> {
  const slug = process.env.DEV_TENANT_SLUG ?? "whittington";
  const [row] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug));
  return row?.id ?? null;
}

/**
 * Ingest, then tell every connected dashboard if anything actually arrived.
 *
 * Silence when nothing changed is deliberate. A dashboard that is told
 * "checked, nothing new" every few seconds has to decide what to do with that
 * fifteen thousand times a day; the only useful message is that there IS
 * something new.
 */
async function ingestAndNotify(
  tenantId: string,
  why: string,
  client?: ImapFlow
): Promise<void> {
  const startedAt = Date.now();
  const elapsed = () => ((Date.now() - startedAt) / 1000).toFixed(1) + "s";

  const tell = (inserted: number) =>
    publish(tenantId, { type: "requests.changed", inserted, at: new Date().toISOString() });

  try {
    const result = await ingestGmailShared(tenantId, {
      since: new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000),
      limit: 25,
      // Ride on the watcher connection rather than opening another. This is
      // the difference between a two-second detection and a four-second one.
      client,
      // Fires the moment a request is stored and interpreted. The dashboard
      // shows it immediately; the certificate is still being assembled.
      onRequestVisible: () => {
        if (DEBUG) console.log(`[watcher] announced to dashboards after ${elapsed()}`);
        tell(1);
      },
    });
    // A follow-up in an existing thread may change a request WITHOUT inserting
    // one — an amendment re-drafts the row that is already there. Gating this
    // on `inserted` alone left those changes off the screen until the next
    // safety refresh.
    if (result.inserted > 0 || result.followUps > 0) {
      const what = [
        result.inserted > 0 ? `${result.inserted} new request(s)` : null,
        result.followUps > 0 ? `${result.followUps} follow-up(s)` : null,
      ]
        .filter(Boolean)
        .join(", ");
      console.log(`[watcher] ${why}: ${what} (drafted at ${elapsed()})`);
      // Again once drafting has finished, so the row gains its "Review
      // certificate" button without the reviewer touching anything.
      tell(0);
    }
  } catch (err) {
    // Logged, not thrown. The next check will try again.
    console.warn(`[watcher] ingest failed (${why}):`, (err as Error).message);
  }
}

async function watchLoop(): Promise<void> {
  let failures = 0;

  for (;;) {
    let client: ImapFlow | null = null;

    try {
      const tenantId = await resolveTenantId();
      if (!tenantId) {
        console.warn("[watcher] no tenant found; retrying in 60s");
        await sleep(60_000);
        continue;
      }

      const config = gmailConfigFromEnv();
      client = new ImapFlow({
        host: config.host ?? "imap.gmail.com",
        port: config.port ?? 993,
        secure: true,
        auth: { user: config.user, pass: config.appPassword },
        // The library logs the whole IMAP conversation at info level, which on
        // a failed login includes the credential.
        logger: false,
      });

      // A dropped connection surfaces as an error event, not a rejected
      // promise. Without this handler Node treats it as unhandled and exits.
      client.on("error", (err: Error) => {
        console.warn("[watcher] connection error:", err.message);
      });

      await client.connect();
      // EXAMINE, not SELECT: the server refuses flag changes on this connection.
      await client.mailboxOpen(config.mailbox ?? "INBOX", { readOnly: true });

      failures = 0;
      console.log(`[watcher] watching ${config.user} (checking every ${CHECK_SECONDS}s)`);

      // THE FAST PATH. imapflow parks an open mailbox in IDLE by itself and
      // raises this when the server announces mail. Usually sub-second.
      client.on("exists", () => {
        void ingestAndNotify(tenantId, "mailbox announced new mail", client ?? undefined);
      });

      // Catch up on anything that arrived while the process was down.
      await ingestAndNotify(tenantId, "start-up sweep", client);

      // Where the mailbox currently ends. Everything at or below this is
      // accounted for by the sweep above.
      let lastSeen = await highestUid(client);
      if (DEBUG) console.log(`[watcher] watermark starts at uid ${lastSeen}`);

      // THE GUARANTEE.
      //
      // A UID search over an ALREADY OPEN connection: no reconnect, no
      // downloads, and almost nothing transferred when nothing is new. That is
      // what makes a five-second check affordable — the cost of being told "no"
      // is one short command on a socket that is already there.
      //
      // It also covers the case IDLE cannot: an announcement that never arrives
      // on a connection that still looks healthy.
      while (client.usable) {
        await sleep(CHECK_SECONDS * 1000);
        if (!client.usable) break;

        // NOOP first. An open mailbox is a SNAPSHOT: the server only reports
        // arrivals as untagged responses attached to some command, so a bare
        // SEARCH keeps returning the view this connection had when it opened.
        // NOOP is the standard way to say "tell me anything you have been
        // holding", and it is the cheapest command in the protocol.
        await client.noop();

        const found = await client.search({ uid: `${lastSeen + 1}:*` }, { uid: true });
        if (DEBUG) console.log(`[watcher] check: lastSeen=${lastSeen} found=${JSON.stringify(found)}`);
        // `n:*` matches the last message even when nothing is newer, so the
        // watermark comparison is what actually decides.
        const fresh = (Array.isArray(found) ? found : []).filter((uid) => uid > lastSeen);
        if (!fresh.length) continue;

        lastSeen = Math.max(...fresh);
        await ingestAndNotify(tenantId, "found new mail", client);
      }

      throw new Error("connection closed");
    } catch (err) {
      const wait = BACKOFF[Math.min(failures, BACKOFF.length - 1)];
      failures++;
      console.warn(`[watcher] ${(err as Error).message} — reconnecting in ${wait}s`);
      await sleep(wait * 1000);
    } finally {
      if (client) {
        try {
          await client.logout();
        } catch {
          client.close();
        }
      }
    }
  }
}

/** The highest UID currently in the open mailbox, or 0 when it is empty. */
async function highestUid(client: ImapFlow): Promise<number> {
  const found = await client.search({ all: true }, { uid: true });
  const uids = Array.isArray(found) ? found : [];
  return uids.length ? Math.max(...uids) : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
