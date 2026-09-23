"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { Button, Field, Input, Notice } from "@/components/Form";

export default function AdminSignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Sign-in failed.");
      window.location.href = body.mustChangePassword ? "/admin/password" : "/admin";
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-900 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3.5 rounded-2xl bg-white p-8 shadow-pop">
        <div className="mb-2 flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink-900 text-white">
            <Icon.Shield width={20} height={20} />
          </span>
          <div>
            <h1 className="text-lg font-bold leading-tight text-ink-900">Nestnic console</h1>
            <p className="text-[12px] text-ink-500">CertFlow platform administration</p>
          </div>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Email">
          <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Button type="submit" busy={busy} className="w-full py-2.5">
          Sign in
        </Button>
        <p className="text-[12px] leading-snug text-ink-500">For Nestnic staff only. Agency users sign in at the main CertFlow page.</p>
      </form>
    </main>
  );
}
