"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { Button, Field, Input, Notice, OneTimeSecret, Section, Toggle, call } from "@/components/Form";

function Badge({ on, children }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${on ? "bg-emerald-100 text-emerald-800" : "bg-ink-900/5 text-ink-500"}`}>
      {children}
    </span>
  );
}

export default function AdminHome() {
  const [tenants, setTenants] = useState(null);
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    call("/api/platform/tenants")
      .then((b) => setTenants(b.tenants))
      .catch((err) => setError(err.message));
    call("/api/platform/access-requests")
      .then((b) => setRequests(b.requests))
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  return (
    <AdminShell>
      <div className="mb-5 flex items-center gap-3">
        <h1 className="flex-1 text-xl font-bold text-ink-900">Agencies</h1>
        {!creating && <Button onClick={() => setCreating(true)}>New agency</Button>}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <AccessRequests requests={requests} onChanged={load} />
      {creating && (
        <CreateAgency
          onDone={() => {
            setCreating(false);
            load();
          }}
        />
      )}

      <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-white">
        {(tenants || []).map((t) => (
          <Link
            key={t.id}
            href={`/admin/tenants/${t.id}`}
            className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-3 last:border-0 hover:bg-surface-hover"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-ink-900">
                {t.name} {t.status !== "active" && <span className="text-[12px] font-medium text-red-600">(suspended)</span>}
              </p>
              <p className="text-[12px] text-ink-500">
                {t.slug} · {t.userCount} user{t.userCount === 1 ? "" : "s"} · data: {t.dataSource === "nowcerts" ? "NowCerts" : "CertFlow"}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge on={t.mailConfigured}>{t.mailConfigured ? "Email connected" : "No email"}</Badge>
              <Badge on={t.allowUserManagement}>{t.allowUserManagement ? "Manages own users" : "Users by Nestnic"}</Badge>
              <Badge on={t.autoSend}>{t.autoSend ? "Auto-send on" : "Manual send"}</Badge>
            </div>
          </Link>
        ))}
        {tenants && !tenants.length && <p className="px-5 py-4 text-[13px] text-ink-500">No agencies yet.</p>}
      </div>
    </AdminShell>
  );
}

function CreateAgency({ onDone }) {
  const [form, setForm] = useState({ name: "", adminName: "", adminEmail: "", allowUserManagement: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await call("/api/platform/tenants", {
        method: "POST",
        body: {
          name: form.name,
          allowUserManagement: form.allowUserManagement,
          admin: { name: form.adminName, email: form.adminEmail },
        },
      });
      setCreated(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="space-y-3">
        <Notice tone="ok">
          Agency created. Send the admin the sign-in address, their email and this temporary password — ideally the password through a
          different channel than the rest.
        </Notice>
        <OneTimeSecret label={`Temporary password for ${created.adminEmail}`} value={created.tempPassword} onDone={onDone} />
      </div>
    );
  }

  return (
    <Section title="New agency" description="Creates the agency, its own encryption key, and its first admin account.">
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Agency name">
        <Input value={form.name} onChange={set("name")} placeholder="Whittington Agency, LLC" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First admin — name">
          <Input value={form.adminName} onChange={set("adminName")} />
        </Field>
        <Field label="First admin — email">
          <Input type="email" value={form.adminEmail} onChange={set("adminEmail")} />
        </Field>
      </div>
      <Toggle
        checked={form.allowUserManagement}
        onChange={(v) => setForm({ ...form, allowUserManagement: v })}
        label="Agency admins can add and remove their own users"
        hint="Off: only Nestnic manages this agency's users (single-admin plan)."
      />
      <div className="flex gap-2">
        <Button busy={busy} onClick={submit}>
          Create agency
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Section>
  );
}

/**
 * Enquiries from the public "Request access" page. Approving one creates the
 * agency and its first admin exactly as the New agency form does — nothing is
 * created until a Nestnic admin clicks it, and nobody is emailed automatically.
 */
function AccessRequests({ requests, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [secret, setSecret] = useState(null);
  if (!requests.length && !secret) return null;

  async function act(request, action) {
    if (action === "decline" && !confirm(`Decline the request from ${request.agencyName}?`)) return;
    setBusy(request.id);
    setNotice(null);
    try {
      const result = await call(`/api/platform/access-requests/${request.id}`, { method: "POST", body: { action } });
      if (action === "approve") {
        setSecret({ label: `Temporary password for ${result.adminEmail}`, value: result.tempPassword });
        setNotice({ tone: "ok", text: `${request.agencyName} created. Send them the sign-in address and this password.` });
      } else {
        setNotice({ tone: "ok", text: "Request declined." });
      }
      onChanged();
    } catch (err) {
      setNotice({ tone: "error", text: err.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-4 space-y-3">
      {secret && <OneTimeSecret label={secret.label} value={secret.value} onDone={() => setSecret(null)} />}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {requests.length > 0 && (
        <Section
          title={`Access requests (${requests.length})`}
          description="From the public website. Approving creates the agency and its first admin."
        >
          <div className="-mx-5 divide-y divide-line-soft">
            {requests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-ink-900">{r.agencyName}</p>
                  <p className="text-[12px] text-ink-500">
                    {r.contactName} · {r.email}
                    {r.phone ? ` · ${r.phone}` : ""}
                  </p>
                  {r.message && <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-ink-600">{r.message}</p>}
                </div>
                <div className="flex gap-1.5">
                  <Button busy={busy === r.id} disabled={Boolean(busy)} onClick={() => act(r, "approve")}>
                    Approve &amp; create
                  </Button>
                  <Button variant="ghost" disabled={Boolean(busy)} onClick={() => act(r, "decline")}>
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
