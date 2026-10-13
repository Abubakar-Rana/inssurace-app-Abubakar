/**
 * GET /api/llm/status — is AI reading working? For every signed-in user: the
 * banner across the top of every screen when it is not, and the status row in
 * Settings -> Automation. `?refresh=1` (admins) re-checks instead of using the
 * cached answer. State and a plain-language reason only — never the key.
 */

import { json, route } from "@/lib/api";
import { llmHealth } from "@/lib/llm/health";

export const dynamic = "force-dynamic";

export const GET = route(async (session, req) => {
  const refresh = new URL(req.url).searchParams.get("refresh") === "1" && session.role === "admin";
  return json(await llmHealth(refresh));
});
