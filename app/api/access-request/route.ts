/**
 * POST /api/access-request — "Request access" from the public page.
 *
 * The only endpoint an anonymous visitor can write to. It creates no account
 * and returns nothing but an acknowledgement: a Nestnic admin reviews the
 * enquiry in the console and decides. Rate limits and validation live in
 * lib/admin/accessRequests.ts.
 */

import { NextResponse } from "next/server";
import { checkOrigin } from "@/lib/api";
import { ServiceError } from "@/lib/certificate/service";
import { submitAccessRequest, type AccessRequestInput } from "@/lib/admin/accessRequests";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    // Same-origin only: this form is on our own marketing page.
    checkOrigin(req);
    const body = (await req.json().catch(() => ({}))) as AccessRequestInput;
    await submitAccessRequest(body, {
      ip: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null,
      userAgent: req.headers.get("user-agent"),
    });
    // Always the same answer, whether it was stored, de-duplicated or dropped.
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[access-request]", err);
    return NextResponse.json({ error: "Could not send your request. Please try again." }, { status: 500 });
  }
}
