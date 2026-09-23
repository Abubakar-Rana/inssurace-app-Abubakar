"use client";

// Frame for the Nestnic console. Visually distinct from the agency app (dark
// bar, "Nestnic console" label) so nobody mistakes which system they are in.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "./icons";

export default function AdminShell({ children }) {
  const [admin, setAdmin] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // Only a 401 means "signed out". A server hiccup is retried rather than
    // bouncing a signed-in admin to the sign-in page.
    async function load(attempt) {
      try {
        const r = await fetch("/api/platform/session");
        if (r.status === 401) {
          window.location.href = "/admin/signin";
          return;
        }
        if (!r.ok) throw new Error(String(r.status));
        const b = await r.json();
        if (cancelled) return;
        if (b.admin.mustChangePassword && window.location.pathname !== "/admin/password") {
          window.location.href = "/admin/password";
          return;
        }
        setAdmin(b.admin);
      } catch {
        if (!cancelled && attempt < 5) setTimeout(() => load(attempt + 1), 1000 * (attempt + 1));
      }
    }
    load(0);
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    await fetch("/api/platform/session", { method: "DELETE" });
    window.location.href = "/admin/signin";
  }

  return (
    <div className="min-h-screen bg-surface-shell">
      <header className="flex h-14 items-center gap-3 bg-ink-900 px-5 text-white">
        <Link href="/admin" className="flex items-center gap-2.5">
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-brand-500">
            <Icon.Shield width={15} height={15} strokeWidth={2} />
          </span>
          <span className="text-[15px] font-semibold">CertFlow</span>
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-white/80">Nestnic console</span>
        </Link>
        <div className="flex-1" />
        {admin && (
          <>
            <span className="hidden text-[12.5px] text-white/70 sm:inline">{admin.email}</span>
            <Link href="/admin/password" className="text-[12.5px] text-white/70 hover:text-white">
              Password
            </Link>
            <button onClick={signOut} className="text-[12.5px] text-white/70 hover:text-white">
              Sign out
            </button>
          </>
        )}
      </header>
      <main className="mx-auto max-w-5xl px-5 py-6">{admin ? children : null}</main>
    </div>
  );
}
