/**
 * Tell every dashboard that something changed, across every process.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS GOES THROUGH POSTGRES
 *
 * The mailbox watcher runs as its own process, and the web server that holds
 * the browser connections is a different one. An in-memory emitter would
 * deliver an event only to browsers attached to whichever process happened to
 * notice the mail — which, with a separate watcher, is none of them. The
 * dashboard would then only update on its slow safety refresh, and the live
 * feed would be live in name only.
 *
 * Postgres is already the one thing every process shares, and LISTEN/NOTIFY is
 * built for exactly this. No queue, no broker, nothing new to run or secure.
 *
 * THE EVENT CARRIES NO DATA — only "requests changed, go and look". The
 * dashboard then re-fetches through the normal authenticated route, so this
 * channel cannot become a way to read rows that route would refuse. It also
 * keeps the payload well inside the 8000-byte NOTIFY limit, which a payload
 * carrying real content would not be.
 *
 * A LOST EVENT IS SURVIVABLE BY DESIGN. Nothing about correctness depends on
 * delivery: a dashboard that misses one still refreshes on its own timer, on
 * tab focus, and on any action the reviewer takes. The failure mode is a slower
 * update, never a wrong screen.
 * ---------------------------------------------------------------------------
 */

import { sqlClient } from "@/lib/db/client";

/** One channel for everything. The tenant is inside the payload. */
const CHANNEL = "certflow_events";

export interface DashboardEvent {
  /** What happened. The client decides what, if anything, to re-fetch. */
  type: "requests.changed" | "ping";
  /** How many new requests were ingested, when that is what happened. */
  inserted?: number;
  /** Server time, so a client can tell a stale replay from a fresh event. */
  at: string;
}

type Listener = (event: DashboardEvent) => void;

/**
 * Listeners keyed by tenant.
 *
 * An event is never delivered outside the tenant it belongs to — the same rule
 * the database enforces on rows, applied here so a cross-tenant leak cannot
 * happen through the notification channel either.
 */
const listeners = new Map<string, Set<Listener>>();

/** Deliver to this process's own listeners. */
function fanOut(tenantId: string, event: DashboardEvent): void {
  const set = listeners.get(tenantId);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(event);
    } catch {
      // The stream is already gone; its own cleanup will remove it.
    }
  }
}

let listening: Promise<void> | null = null;

/**
 * Subscribe this process to the shared channel, once.
 *
 * Idempotent and lazy: only a process that actually has dashboards attached
 * needs to listen, and the watcher process never calls this.
 */
function ensureListening(): Promise<void> {
  listening ??= sqlClient
    .listen(CHANNEL, (payload) => {
      try {
        const { tenantId, event } = JSON.parse(payload) as {
          tenantId: string;
          event: DashboardEvent;
        };
        fanOut(tenantId, event);
      } catch {
        // A malformed payload is not worth taking the listener down for.
      }
    })
    .then(() => undefined)
    .catch((err) => {
      // Reset so a later subscriber retries rather than inheriting a dead
      // promise. The dashboard still works, just on its slower refresh.
      listening = null;
      console.warn("[events] could not subscribe:", (err as Error).message);
    });
  return listening;
}

/** Subscribe to one tenant's events. Returns the unsubscribe function. */
export function subscribe(tenantId: string, listener: Listener): () => void {
  void ensureListening();

  let set = listeners.get(tenantId);
  if (!set) {
    set = new Set();
    listeners.set(tenantId, set);
  }
  set.add(listener);

  return () => {
    const current = listeners.get(tenantId);
    if (!current) return;
    current.delete(listener);
    // Drop the empty set rather than accumulating one per tenant forever.
    if (current.size === 0) listeners.delete(tenantId);
  };
}

/**
 * Announce a change to every process.
 *
 * Delivered locally first so a same-process listener does not wait on a
 * database round trip, then published for everyone else. Failure to publish is
 * logged and swallowed: the change itself is already committed, and an
 * undelivered notification must never fail the work that caused it.
 */
export function publish(tenantId: string, event: DashboardEvent): void {
  fanOut(tenantId, event);

  void sqlClient
    .notify(CHANNEL, JSON.stringify({ tenantId, event }))
    .catch((err) => console.warn("[events] could not publish:", (err as Error).message));
}

/** How many dashboards are listening IN THIS PROCESS. */
export function listenerCount(tenantId?: string): number {
  if (tenantId) return listeners.get(tenantId)?.size ?? 0;
  let total = 0;
  for (const set of listeners.values()) total += set.size;
  return total;
}
