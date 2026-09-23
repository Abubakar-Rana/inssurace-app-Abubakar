"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Button, Field, Input, Notice, call } from "@/components/Form";

export default function ChangePasswordPage() {
  const [user, setUser] = useState(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((b) => setUser(b.user))
      .catch(() => (window.location.href = "/signin"));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) return setError("The new passwords do not match.");
    setBusy(true);
    try {
      await call("/api/auth/password", { method: "POST", body: { current, next } });
      window.location.href = "/inbox";
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const forced = user?.mustChangePassword;

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3.5 rounded-2xl bg-white p-8 shadow-card">
        <div className="mb-2 flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white">
            <Icon.Shield width={20} height={20} />
          </span>
          <div>
            <h1 className="text-lg font-bold leading-tight text-ink-900">
              {forced ? "Set your password" : "Change password"}
            </h1>
            <p className="text-[12px] text-ink-500">{user?.email}</p>
          </div>
        </div>

        {forced && (
          <Notice tone="info">
            You signed in with a temporary password. Choose your own to continue — nobody else will know it.
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}

        <Field label={forced ? "Temporary password" : "Current password"}>
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="New password" hint="At least 10 characters, with a letter and a number.">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </Field>
        <Field label="Confirm new password">
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
        <Button type="submit" busy={busy} className="w-full py-2.5">
          Save password
        </Button>
        {!forced && (
          <a href="/inbox" className="block text-center text-[12.5px] text-ink-500 hover:text-ink-700">
            Cancel
          </a>
        )}
      </form>
    </main>
  );
}
