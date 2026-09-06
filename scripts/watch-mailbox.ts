/**
 * The mailbox watcher, as its own process.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE PROCESS AND NOT PART OF THE WEB SERVER
 *
 * A long-lived IMAP connection is a worker concern. Running it inside the web
 * server means it restarts on every deploy, duplicates itself across instances,
 * and — because Next.js compiles its start-up hook for the Edge runtime too,
 * where TCP sockets do not exist — cannot cleanly be started at boot there
 * anyway.
 *
 * As a process it is simply: connect, watch, ingest, repeat. It shares the same
 * ingest path as everything else, so nothing about correctness depends on which
 * process noticed the mail.
 *
 * TWO WATCHERS ARE HARMLESS. The web server also starts one when a dashboard
 * connects, so in development a single `npm run dev` still works on its own.
 * Both ingesting the same message is a no-op: the unique index on
 * (tenant, gmail_message_id) is what makes that safe, and it is enforced by the
 * database rather than by coordination between processes. Set GMAIL_WATCH=0 on
 * the web process to run this one alone.
 *
 *   npm run watch
 * ---------------------------------------------------------------------------
 */

import "@/lib/env";
import { startWatching } from "@/lib/gmail/watcher";

console.log("CertFlow mailbox watcher");
console.log("Ctrl-C to stop.\n");

startWatching();

// Nothing else to do. The watcher owns its own loop and reconnects on its own;
// this process exists to hold it open.
process.on("SIGINT", () => {
  console.log("\nstopped.");
  process.exit(0);
});
