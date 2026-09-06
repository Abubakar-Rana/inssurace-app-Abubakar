"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons";

// useSearchParams opts the subtree out of prerendering, so it needs a boundary.
export default function SignInPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-ink-50" />}>
      <SignIn />
    </Suspense>
  );
}

function SignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const [oidc, setOidc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(params.get("error"));

  // Already signed in? Skip the page.
  useEffect(() => {
    fetch("/api/auth/session")
      .then(async (r) => {
        const body = await r.json();
        if (r.ok) router.replace("/");
        else setOidc(Boolean(body.oidc));
      })
      .catch(() => {});
  }, [router]);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Sign-in failed.");
      // A full page load, not router.replace: StoreProvider lives in the root
      // layout, so a client-side navigation would not remount it and the inbox
      // would render with the empty state it fetched while signed out.
      window.location.href = body.redirect || "/";
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-card">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white">
            <Icon.Shield width={20} height={20} />
          </span>
          <div>
            <h1 className="text-lg font-bold leading-tight text-ink-900">CertFlow</h1>
            <p className="text-[12px] text-ink-500">Certificate automation</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">{error}</div>
        )}

        <button
          onClick={signIn}
          disabled={busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "Signing in…" : oidc ? "Sign in with your work account" : "Sign in (development)"}
        </button>

        <p className="mt-4 text-[12px] leading-snug text-ink-500">
          {oidc
            ? "Authentication is handled by your organisation's identity provider, including multi-factor. CertFlow never sees your password."
            : "No identity provider is configured, so this signs in as the seeded user. Set OIDC_ISSUER and related variables to enable real sign-in — the development path is refused in production."}
        </p>
      </div>
    </main>
  );
}
