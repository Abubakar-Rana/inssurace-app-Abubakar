"use client";

// One agency, as Nestnic sees it: account switches and users. Deliberately no
// requests, certificates or credentials — the console manages access, it does
// not read an agency's business data.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { Button, Field, Input, Notice, OneTimeSecret, Section, Select, Toggle, call } from "@/components/Form";

function when(iso) {
  if (!iso) return "never";
  const [d] = String(iso).split("T");
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
}

export default function AgencyDetail({ params }) {
  const base = `/api/platform/tenants/${params.id}`;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [secret, setSecret] = useState(null);
  const [busy, setBusy] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", role: "reviewer" });

  const load = useCallback(() => {
    call(base)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [base]);
  useEffect(load, [load]);

  async function act(name, fn, ok) {
    setBusy(name);
    setNotice(null);
    try {
      const r = await fn();
      if (ok) setNotice({ tone: "ok", text: ok });
      load();
      return r;
    } catch (err) {
      setNotice({ tone: "error", text: err.message });
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <AdminShell>
        <Notice tone="error">{error}</Notice>
      </AdminShell>
    );
  }
  if (!data) {
    return (
      <AdminShell>
        <p className="text-[13px] text-ink-500">Loading…</p>
      </AdminShell>
    );
  }
  const { tenant, users } = data;

  return (
    <AdminShell>
      <Link href="/admin" className="text-[12.5px] text-ink-500 hover:text-ink-800">
        ← All agencies
      </Link>
      <h1 className="mb-5 mt-1 text-xl font-bold text-ink-900">{tenant.name}</h1>

      <div className="space-y-4">
        <OneTimeSecret label={secret?.label} value={secret?.value} onDone={() => setSecret(null)} />
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

        <Section
          title="Account"
          description={`Short name: ${tenant.slug} · created ${when(tenant.createdAt)} · email ${
            tenant.mailConfigured ? "connected" : "not connected"
          } · data from ${tenant.dataSource === "nowcerts" ? "NowCerts" : "CertFlow"}`}
        >
          <Toggle
            checked={tenant.allowUserManagement}
            disabled={Boolean(busy)}
            onChange={(v) => act("perm", () => call(base, { method: "PATCH", body: { allowUserManagement: v } }), "Updated.")}
            label="Agency admins can add and remove their own users"
            hint="Off: only Nestnic can create, disable or reset users for this agency."
          />
          <Toggle
            checked={tenant.status === "active"}
            disabled={Boolean(busy)}
            onChange={(v) =>
              (v || confirm(`Suspend ${tenant.name}? All its users are signed out at once and its mailbox stops being read.`)) &&
              act(
                "status",
                () => call(base, { method: "PATCH", body: { status: v ? "active" : "suspended" } }),
                v ? "Agency re-activated." : "Agency suspended."
              )
            }
            label="Agency active"
            hint="Suspending blocks every sign-in for this agency and stops its mailbox. Nothing is deleted."
          />
        </Section>

        <Section title="Users">
          <div className="-mx-5 divide-y divide-line-soft">
            {users.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-ink-900">
                    {u.name} {u.status !== "active" && <span className="text-[11.5px] text-red-600">(disabled)</span>}
                    {u.mustChangePassword && <span className="ml-1 text-[11.5px] text-amber-700">(temporary password)</span>}
                  </p>
                  <p className="text-[12px] text-ink-500">
                    {u.email} · {u.role} · last sign-in {when(u.lastLoginAt)}
                  </p>
                </div>
                <div className="w-32">
                  <Select
                    value={u.role}
                    onChange={(e) =>
                      act("role", () => call(`${base}/users/${u.id}`, { method: "PATCH", body: { role: e.target.value } }), "Role updated.")
                    }
                  >
                    <option value="admin">admin</option>
                    <option value="reviewer">reviewer</option>
                    <option value="readonly">readonly</option>
                  </Select>
                </div>
                <Button
                  variant="ghost"
                  disabled={Boolean(busy)}
                  onClick={async () => {
                    const r = await act("reset", () => call(`${base}/users/${u.id}/reset`, { method: "POST" }), "New temporary password issued.");
                    if (r) setSecret({ label: `Temporary password for ${u.email}`, value: r.tempPassword });
                  }}
                >
                  Reset password
                </Button>
                <Button
                  variant={u.status === "active" ? "danger" : "secondary"}
                  disabled={Boolean(busy)}
                  onClick={() =>
                    act(
                      "ustatus",
                      () =>
                        call(`${base}/users/${u.id}`, {
                          method: "PATCH",
                          body: { status: u.status === "active" ? "disabled" : "active" },
                        }),
                      "Updated."
                    )
                  }
                >
                  {u.status === "active" ? "Disable" : "Enable"}
                </Button>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Add a user" description="They receive a temporary password and must choose their own at first sign-in.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Role">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="reviewer">Reviewer</option>
                <option value="admin">Admin</option>
                <option value="readonly">Read-only</option>
              </Select>
            </Field>
          </div>
          <Button
            busy={busy === "add"}
            onClick={async () => {
              const r = await act("add", () => call(`${base}/users`, { method: "POST", body: form }), "User added.");
              if (r) {
                setSecret({ label: `Temporary password for ${r.email}`, value: r.tempPassword });
                setForm({ name: "", email: "", role: "reviewer" });
              }
            }}
          >
            Add user
          </Button>
        </Section>
      </div>
    </AdminShell>
  );
}
