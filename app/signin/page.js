"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons";
import { Button, Field, Input, Notice } from "@/components/Form";

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
  const [dev, setDev] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(params.get("error"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Already signed in? Skip the page.
  useEffect(() => {
    fetch("/api/auth/session")
      .then(async (r) => {
        const body = await r.json();
        if (r.ok) router.replace(body.user?.mustChangePassword ? "/account/password" : "/inbox");
        else {
          setOidc(Boolean(body.oidc));
          setDev(Boolean(body.dev));
        }
      })
      .catch(() => {});
  }, [router]);

  async function withPassword(e) {
    e.preventDefault();
    setBusy("password");
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Sign-in failed.");
      // A full page load, not router.replace: StoreProvider lives in the root
      // layout, so a client-side navigation would not remount it and the inbox
      // would render with the empty state it fetched while signed out.
      window.location.href = body.mustChangePassword ? "/account/password" : "/inbox";
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  }

  // The identity-provider button and the development fallback share the
  // original endpoint, which decides between them.
  async function withProvider() {
    setBusy("provider");
    setError(null);
    try {
      const res = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Sign-in failed.");
      window.location.href = body.redirect || "/inbox";
    } catch (err) {
      setError(err.message);
      setBusy(null);
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
          <div className="mb-4">
            <Notice tone="error">{error}</Notice>
          </div>
        )}

        <form onSubmit={withPassword} className="space-y-3.5">
          <Field label="Email">
            <Input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" busy={busy === "password"} disabled={Boolean(busy)} className="w-full py-2.5">
            Sign in
          </Button>
        </form>

        {(oidc || dev) && (
          <>
            <div className="my-5 flex items-center gap-3 text-[11.5px] text-ink-400">
              <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
            </div>
            <Button
              variant="secondary"
              onClick={withProvider}
              busy={busy === "provider"}
              disabled={Boolean(busy)}
              className="w-full py-2.5"
            >
              {oidc ? "Sign in with Google / Microsoft" : "Sign in (development)"}
            </Button>
          </>
        )}

        <p className="mt-5 text-[12px] leading-snug text-ink-500">
          Accounts are created by your administrator. Forgot your password? Ask them to reset it.
        </p>
      </div>
    </main>
  );
}
