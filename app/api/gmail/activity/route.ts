/**
 * GET /api/gmail/activity — what the mailbox filter passed over recently.
 *
 * The filter is a heuristic, so the only honest way to run it is with its
 * misses reachable. A false negative loses a customer's request; this is how a
 * reviewer checks that nothing they were expecting was quietly dropped.
 *
 * Held in memory by the ingest layer and lost on restart — a diagnostic aid,
 * not a record. Mail we deliberately never stored has no business in the audit
 * log either.
 */

import { json, route } from "@/lib/api";
import { getRecentlyIgnored } from "@/lib/gmail/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (session) => json({ ignored: getRecentlyIgnored(session.tenantId) }));
