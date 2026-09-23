/** GET /api/platform/access-requests — enquiries from the public page, newest first. */

import { json, platformRoute } from "@/lib/api";
import { listAccessRequests } from "@/lib/admin/accessRequests";

export const dynamic = "force-dynamic";

export const GET = platformRoute(async (_admin, req) => {
  const status = new URL(req.url).searchParams.get("status") ?? undefined;
  return json({ requests: await listAccessRequests(status === "all" ? undefined : status ?? "new") });
});
