/**
 * GET /api/events — a live stream of "something changed" for one dashboard.
 *
 * Server-Sent Events rather than a WebSocket, because the traffic is entirely
 * one-way. The browser has nothing to say back here; it acts through the normal
 * API routes. SSE gets that with an ordinary HTTP response, automatic
 * reconnection built into the browser, and no second protocol to secure,
 * authenticate or proxy.
 *
 * THE STREAM CARRIES NO DATA. Every message says only "requests changed, go and
 * look". The dashboard then re-fetches through the normal, authenticated route.
 * That keeps one path to the data, so this connection cannot become a way to
 * read rows the ordinary route would have refused.
 *
 * This route is also where the mailbox watcher gets started. It is a Node
 * runtime route, so the IMAP stack is available here; opening the dashboard
 * therefore starts the watcher, and the watcher keeps running afterwards
 * whether or not anyone is still connected.
 */

import { requireSession } from "@/lib/auth/session";
import { startWatching } from "@/lib/gmail/watcher";
import { subscribe, type DashboardEvent } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Idle proxies close a quiet connection; a comment line keeps it open. */
const HEARTBEAT_MS = 20_000;

export async function GET(): Promise<Response> {
  // Deliberately not wrapped in `route()`: that helper is built around JSON
  // request/response, and this is a stream that stays open. The session check
  // is the part that matters, and it is done here explicitly.
  let session;
  try {
    session = await requireSession();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  startWatching();

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: DashboardEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          cleanup();
        }
      };

      const cleanup = () => {
        unsubscribe?.();
        unsubscribe = null;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
      };

      // Tell the browser immediately that the stream is live, so the dashboard
      // can show that it is connected rather than guessing.
      send({ type: "ping", at: new Date().toISOString() });

      unsubscribe = subscribe(session.tenantId, send);

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          cleanup();
        }
      }, HEARTBEAT_MS);
    },

    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx buffers proxied responses by default, which would hold each
      // message until the buffer filled and defeat the point of streaming.
      "X-Accel-Buffering": "no",
    },
  });
}
