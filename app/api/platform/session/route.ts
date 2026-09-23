/**
 * GET    /api/platform/session — who am I in the Nestnic console (or 401)
 * DELETE /api/platform/session — sign out of it
 */

import { NextResponse } from "next/server";
import { getPlatformSession, PLATFORM_COOKIE, platformCookieOptions } from "@/lib/auth/platform";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await getPlatformSession();
  if (!admin) return NextResponse.json({ admin: null }, { status: 401 });
  return NextResponse.json({ admin: { email: admin.email, name: admin.name, mustChangePassword: admin.mustChangePassword } });
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PLATFORM_COOKIE, "", { ...platformCookieOptions(), maxAge: 0 });
  return res;
}
