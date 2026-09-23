/** POST /api/platform/password — a Nestnic admin replaces their own password. */

import { NextResponse } from "next/server";
import { ServiceError } from "@/lib/certificate/service";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { platformAdmins } from "@/db/schema";
import { checkOrigin } from "@/lib/api";
import { getPlatformSession } from "@/lib/auth/platform";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const session = await getPlatformSession();
    if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { current?: unknown; next?: unknown };
    const current = typeof body.current === "string" ? body.current : "";
    const next = typeof body.next === "string" ? body.next : "";
    // The console can provision admins for every agency, so it asks for more.
    const problem = passwordProblem(next, session.email) ?? (next.length < 12 ? "Use at least 12 characters." : null);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    if (next === current) return NextResponse.json({ error: "Choose a different password." }, { status: 400 });

    const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.id, session.adminId));
    if (!admin || !(await verifyPassword(current, admin.passwordHash))) {
      return NextResponse.json({ error: "Your current password is incorrect." }, { status: 400 });
    }
    await db
      .update(platformAdmins)
      .set({ passwordHash: await hashPassword(next), mustChangePassword: false })
      .where(eq(platformAdmins.id, admin.id));
    console.log(`[platform] ${admin.email} changed their password`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[platform/password]", err);
    return NextResponse.json({ error: "Could not change the password." }, { status: 500 });
  }
}
