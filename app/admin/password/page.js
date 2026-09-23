"use client";

import { useState } from "react";
import AdminShell from "@/components/AdminShell";
import { Button, Field, Input, Notice, Section, call } from "@/components/Form";

export default function AdminPassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) return setError("The new passwords do not match.");
    setBusy(true);
    try {
      await call("/api/platform/password", { method: "POST", body: { current, next } });
      window.location.href = "/admin";
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <form onSubmit={submit} className="mx-auto max-w-md">
        <Section title="Set your password" description="At least 12 characters, with a letter and a number. Required after a temporary password.">
          {error && <Notice tone="error">{error}</Notice>}
          <Field label="Current or temporary password">
            <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </Field>
          <Field label="New password">
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          <Button type="submit" busy={busy}>Save password</Button>
        </Section>
      </form>
    </AdminShell>
  );
}
