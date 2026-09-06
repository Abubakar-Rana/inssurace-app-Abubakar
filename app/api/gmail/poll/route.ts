/**
 * POST /api/gmail/poll — fetch new mail and interpret it.
 *
 * Driven by the open dashboard, on a timer — a reviewer should not have to ask
 * whether they have work. There is still no background daemon: nothing polls
 * when nobody is looking, so the mailbox is only read on behalf of someone who
 * is actually watching the result.
 *
 * That means N tabs would otherwise mean N mailbox reads per tick, which is
 * why the handler goes through ingestGmailShared — see the note at the foot of
 * lib/gmail/ingest.ts.
 *
 * Idempotent — already-ingested messages are skipped by the unique index, so a
 * double click, a double tab, or a retry costs a round trip and nothing else.
 */

import { json, readJson, route } from "@/lib/api";
import { requireWrite } from "@/lib/auth/session";
import { ingestGmailShared } from "@/lib/gmail/ingest";
import { ServiceError } from "@/lib/certificate/service";

export const dynamic = "force-dynamic";

export const POST = route(async (session, req) => {
  requireWrite(session);

  const body = await readJson<{ days?: number; limit?: number }>(req).catch(() => ({}) as never);
  const days = Math.min(Math.max(Number(body?.days) || 7, 1), 90);
  const limit = Math.min(Math.max(Number(body?.limit) || 25, 1), 100);

  try {
    const result = await ingestGmailShared(session.tenantId, {
      since: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
      limit,
    });
    return json({ result });
  } catch (err) {
    // A missing or rejected App Password is a configuration problem the
    // reviewer can act on, not a 500 to be swallowed.
    const message = err instanceof Error ? err.message : "Could not reach the mailbox.";
    throw new ServiceError(message, 502);
  }
});
