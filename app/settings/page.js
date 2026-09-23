"use client";

// Agency settings — admins only. Every secret field is write-only: the server
// says whether a password is stored, never what it is, so the inputs start
// empty and "leave blank to keep" is the rule throughout.

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { Icon } from "@/components/icons";
import {
  Button,
  Field,
  Input,
  Notice,
  OneTimeSecret,
  Section,
  Select,
  Toggle,
  call,
} from "@/components/Form";

const TABS = [
  { id: "agency", label: "Agency details" },
  { id: "email", label: "Email" },
  { id: "data", label: "Data source" },
  { id: "automation", label: "Automation" },
  { id: "users", label: "Users" },
];

// Hand-formatted to keep server and client output identical (no Date in render).
function when(iso) {
  if (!iso) return "never";
  const [d, t] = String(iso).split("T");
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y} ${t?.slice(0, 5) ?? ""} UTC`;
}

export default function SettingsPage() {
  const store = useStore();
  const [tab, setTab] = useState("agency");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    call("/api/settings")
      .then(setData)
      .catch((err) => setError(err.status === 403 ? "Only agency admins can open Settings." : err.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    if (TABS.some((t) => t.id === wanted)) setTab(wanted);
  }, []);

  return (
    <AppShell inboxCount={store.requests.filter((r) => r.status === "new").length}>
      <div className="mx-auto max-w-3xl px-5 py-6">
        <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-brand-600">
          <Icon.Settings width={16} height={16} /> Settings
        </div>
        <h1 className="mb-5 text-xl font-bold text-ink-900">{data?.agency?.name || "Your agency"}</h1>

        {error && <Notice tone="error">{error}</Notice>}

        {data && (
          <>
            <div className="mb-5 flex flex-wrap gap-1 border-b border-line">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition ${
                    tab === t.id ? "border-brand-500 text-ink-900" : "border-transparent text-ink-500 hover:text-ink-800"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {tab === "agency" && <AgencyTab producer={data.producer} onSaved={load} />}
            {tab === "email" && <EmailTab mail={data.mail} onSaved={load} />}
            {tab === "data" && <DataTab nowcerts={data.nowcerts} demo={data.demo} onSaved={load} />}
            {tab === "automation" && <AutomationTab agency={data.agency} onSaved={load} />}
            {tab === "users" && <UsersTab canManage={data.canManageUsers} />}
          </>
        )}
      </div>
    </AppShell>
  );
}

function useAction() {
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const run = async (name, fn, okText) => {
    setBusy(name);
    setNotice(null);
    try {
      const result = await fn();
      setNotice({ tone: "ok", text: typeof okText === "function" ? okText(result) : okText });
      return result;
    } catch (err) {
      setNotice({ tone: "error", text: err.message });
    } finally {
      setBusy(null);
    }
  };
  return { busy, notice, run };
}

// ---------------------------------------------------------------- agency

function AgencyTab({ producer, onSaved }) {
  const [form, setForm] = useState(producer);
  const { busy, notice, run } = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <Section
      title="Producer details"
      description="How your agency appears in the PRODUCER box of every certificate."
    >
      <Field label="Agency name">
        <Input value={form.name} onChange={set("name")} />
      </Field>
      <Field label="Address" hint="Up to 3 lines, e.g. street on the first line, city, state and ZIP on the second.">
        <textarea
          rows={3}
          value={form.addressLines}
          onChange={set("addressLines")}
          className="w-full rounded-lg border border-line px-3 py-2 text-[13.5px] outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact name">
          <Input value={form.contactName} onChange={set("contactName")} />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={set("phone")} />
        </Field>
        <Field label="Fax">
          <Input value={form.fax} onChange={set("fax")} />
        </Field>
      </div>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      <Button
        busy={busy === "save"}
        onClick={() =>
          run("save", () => call("/api/settings/producer", { method: "PUT", body: form }), "Saved.").then(onSaved)
        }
      >
        Save
      </Button>
    </Section>
  );
}

// ---------------------------------------------------------------- email

const PROVIDERS = {
  gmail: { label: "Gmail / Google Workspace", imapHost: "imap.gmail.com", smtpHost: "smtp.gmail.com", smtpPort: 465 },
  outlook: { label: "Outlook / Microsoft 365", imapHost: "outlook.office365.com", smtpHost: "smtp.office365.com", smtpPort: 587 },
  yahoo: { label: "Yahoo Mail", imapHost: "imap.mail.yahoo.com", smtpHost: "smtp.mail.yahoo.com", smtpPort: 465 },
  other: { label: "Other provider", imapHost: "", smtpHost: "", smtpPort: 465 },
};

function providerOf(mail) {
  return Object.keys(PROVIDERS).find((k) => k !== "other" && PROVIDERS[k].imapHost === mail.imapHost) || "other";
}

/**
 * Open the provider's consent screen in a pop-up and resolve when it reports
 * back. Falls back to a full-page redirect when pop-ups are blocked. Only
 * messages from our own origin, of our own type, are accepted.
 */
function connectInbox(provider) {
  return new Promise((resolve) => {
    const url = `/api/mail/oauth/${provider}/start`;
    const w = 520;
    const h = 680;
    const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
    const popup = window.open(url, "certflow-connect", `width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) {
      window.location.href = url;
      return;
    }
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearInterval(timer);
      resolve(result);
    };
    const onMessage = (e) => {
      if (e.origin !== window.location.origin || e.data?.type !== "certflow-mail-oauth") return;
      finish(e.data);
    };
    window.addEventListener("message", onMessage);
    // Closed without finishing: treat as cancelled.
    const timer = setInterval(() => popup.closed && setTimeout(() => finish(null), 300), 500);
  });
}

const PROVIDER_NAMES = { google: "Gmail", microsoft: "Outlook / Microsoft 365", imap: "App password" };

function EmailTab({ mail, onSaved }) {
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const connected = mail.configured && !mail.usingEnvironmentMailbox;

  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get("mail");
    if (flag === "connected") setNotice({ tone: "ok", text: "Inbox connected." });
    if (flag === "failed") setNotice({ tone: "error", text: "The inbox was not connected. Please try again." });
  }, []);

  async function connect(provider) {
    setBusy(provider);
    setNotice(null);
    const result = await connectInbox(provider);
    setBusy(null);
    if (!result) return; // closed the pop-up
    setNotice({ tone: result.ok ? "ok" : "error", text: result.message });
    if (result.ok) onSaved();
  }

  async function disconnect() {
    if (!confirm("Disconnect this inbox? CertFlow will stop reading new requests and cannot send certificates until an inbox is connected again.")) return;
    setBusy("remove");
    try {
      await call("/api/settings/mail", { method: "DELETE" });
      setNotice({ tone: "ok", text: "Inbox disconnected. CertFlow no longer has access to it." });
      onSaved();
    } catch (err) {
      setNotice({ tone: "error", text: err.message });
    } finally {
      setBusy(null);
    }
  }

  const button = (provider, label) => (
    <Button
      variant={connected ? "secondary" : "primary"}
      busy={busy === provider}
      disabled={Boolean(busy) || !mail.available?.[provider]}
      onClick={() => connect(provider)}
      className="min-w-[200px] py-2.5"
    >
      {label}
    </Button>
  );

  return (
    <div className="space-y-4">
      <Section
        title="Request inbox"
        description="The email address your clients send certificate requests to. CertFlow reads new requests from it and sends each certificate back from it, in the same email thread."
      >
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

        {connected ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-shell p-4">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-ink-900">{mail.emailAddress}</p>
              <p className="text-[12px] text-ink-500">
                {PROVIDER_NAMES[mail.provider] || "Connected"}
                {mail.lastCheckedAt ? ` · last checked ${when(mail.lastCheckedAt)}` : ""}
              </p>
            </div>
            <Button variant="danger" busy={busy === "remove"} disabled={Boolean(busy)} onClick={disconnect}>
              Disconnect
            </Button>
          </div>
        ) : (
          <Notice tone="info">
            {mail.usingEnvironmentMailbox
              ? `Currently using the inbox set up by Nestnic (${mail.emailAddress}). Connect your own below to replace it.`
              : "No inbox connected yet. Connect the one your clients send requests to — it takes about a minute."}
          </Notice>
        )}
        {connected && mail.lastError && <Notice tone="error">Problem with this inbox: {mail.lastError}</Notice>}

        <div>
          <p className="mb-2 text-[12.5px] font-medium text-ink-700">{connected ? "Switch to a different inbox" : "Connect your inbox"}</p>
          <div className="flex flex-wrap gap-2">
            {button("google", "Connect Gmail")}
            {button("microsoft", "Connect Outlook / Microsoft 365")}
          </div>
          {(!mail.available?.google || !mail.available?.microsoft) && (
            <p className="mt-2 text-[12px] text-ink-500">
              {!mail.available?.google && !mail.available?.microsoft
                ? "Inbox sign-in is not set up on this server yet — Nestnic needs to finish setup."
                : `${!mail.available?.google ? "Gmail" : "Outlook"} sign-in is not set up on this server yet.`}
            </p>
          )}
          <p className="mt-3 text-[12px] leading-snug text-ink-500">
            A {"Google or Microsoft"} window opens and asks you to allow CertFlow to <b>read</b> and <b>send</b> email. CertFlow never sees
            your password, cannot delete or move your mail, and you can disconnect at any time here or in your Google / Microsoft account
            settings.
          </p>
        </div>
      </Section>

      <details className="rounded-2xl border border-line bg-white px-5 py-3 text-[13px] text-ink-600">
        <summary className="cursor-pointer select-none font-medium text-ink-700">Advanced: connect with an app password instead</summary>
        <div className="mt-3">
          <AppPasswordForm mail={mail} onSaved={onSaved} />
        </div>
      </details>
    </div>
  );
}

function AppPasswordForm({ mail, onSaved }) {
  const [provider, setProvider] = useState(providerOf(mail));
  const [form, setForm] = useState({
    emailAddress: mail.usingEnvironmentMailbox || mail.provider !== "imap" ? "" : mail.emailAddress,
    username: mail.username,
    password: "",
    imapHost: mail.imapHost,
    imapPort: mail.imapPort,
    smtpHost: mail.smtpHost,
    smtpPort: mail.smtpPort,
  });
  const { busy, notice, run } = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  function pickProvider(key) {
    setProvider(key);
    const p = PROVIDERS[key];
    if (key !== "other") setForm({ ...form, imapHost: p.imapHost, imapPort: 993, smtpHost: p.smtpHost, smtpPort: p.smtpPort });
  }

  const results = (r) => [r?.imap, r?.smtp].filter(Boolean).join(" ") || "Saved.";

  return (
    <div className="space-y-4">
      <Section
        title="App password (IMAP/SMTP)"
        description="For email providers without a sign-in button above. CertFlow opens the inbox read-only: it never deletes, moves or marks your mail."
      >
        {mail.usingEnvironmentMailbox && (
          <Notice tone="info">
            Currently using the mailbox set up by Nestnic ({mail.emailAddress}). Saving your own below replaces it.
          </Notice>
        )}
        {mail.provider === "imap" && !mail.usingEnvironmentMailbox && (
          <Notice tone={mail.lastError ? "error" : "ok"}>
            {mail.lastError
              ? `Last connection problem: ${mail.lastError}`
              : `Connected${mail.lastCheckedAt ? ` · last connected ${when(mail.lastCheckedAt)}` : ""}.`}
          </Notice>
        )}

        <Field label="Email provider">
          <Select value={provider} onChange={(e) => pickProvider(e.target.value)}>
            {Object.entries(PROVIDERS).map(([k, p]) => (
              <option key={k} value={k}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mailbox email address">
            <Input type="email" value={form.emailAddress} onChange={set("emailAddress")} placeholder="certificates@youragency.com" />
          </Field>
          <Field
            label="Login name"
            hint="Leave blank — Gmail, Outlook and most providers sign in with the full email address above."
          >
            <Input value={form.username} onChange={set("username")} placeholder="(same as email)" />
          </Field>
        </div>
        <Field
          label="App password"
          hint={
            mail.passwordSet
              ? "A password is saved. Leave blank to keep it."
              : provider === "gmail"
                ? "Use a Google App Password (Google Account → Security → 2-Step Verification → App passwords), not your normal password."
                : "Use an app password from your email provider if it offers one."
          }
        >
          <Input type="password" autoComplete="new-password" value={form.password} onChange={set("password")} placeholder={mail.passwordSet ? "••••••••••••" : ""} />
        </Field>

        {provider === "other" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Incoming (IMAP) server" hint="Port 993, encrypted.">
              <Input value={form.imapHost} onChange={set("imapHost")} placeholder="imap.example.com" />
            </Field>
            <Field label="Outgoing (SMTP) server">
              <Input value={form.smtpHost} onChange={set("smtpHost")} placeholder="smtp.example.com" />
            </Field>
            <Field label="SMTP port">
              <Select value={form.smtpPort} onChange={set("smtpPort")}>
                <option value={465}>465 (SSL)</option>
                <option value={587}>587 (STARTTLS)</option>
              </Select>
            </Field>
          </div>
        )}

        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

        <div className="flex flex-wrap gap-2">
          <Button
            busy={busy === "save"}
            disabled={Boolean(busy)}
            onClick={() =>
              run("save", () => call("/api/settings/mail", { method: "PUT", body: { ...form, test: true } }), results).then(
                (r) => r && onSaved()
              )
            }
          >
            Test and save
          </Button>
          <Button
            variant="secondary"
            busy={busy === "test"}
            disabled={Boolean(busy)}
            onClick={() => run("test", () => call("/api/settings/mail/test", { method: "POST", body: form }), results)}
          >
            Test only
          </Button>
          {mail.provider === "imap" && !mail.usingEnvironmentMailbox && (
            <Button
              variant="danger"
              busy={busy === "remove"}
              disabled={Boolean(busy)}
              onClick={() =>
                confirm("Disconnect this mailbox? CertFlow will stop reading new requests.") &&
                run("remove", () => call("/api/settings/mail", { method: "DELETE" }), "Disconnected.").then(onSaved)
              }
            >
              Disconnect
            </Button>
          )}
        </div>
      </Section>
      <p className="px-1 text-[12px] leading-snug text-ink-500">
        The password is encrypted with your agency's own key before it is stored and is never shown again — not to you, and not to Nestnic staff.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- data source

function DataTab({ nowcerts, demo, onSaved }) {
  const [form, setForm] = useState({ username: nowcerts.username, password: "", syncIntervalMinutes: nowcerts.syncIntervalMinutes });
  const { busy, notice, run } = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const stats = nowcerts.lastSyncStats;

  return (
    <div className="space-y-4">
      <Section
        title="Where client and policy data comes from"
        description="Certificates are filled from this source. Matching and certificate layout work the same either way."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { id: "certflow", title: "CertFlow database", text: "Clients and policies are managed in CertFlow." },
            { id: "nowcerts", title: "NowCerts", text: "Clients, policies and vehicles are copied from NowCerts automatically." },
          ].map((o) => (
            <button
              key={o.id}
              disabled={Boolean(busy) || (o.id === "nowcerts" && !nowcerts.configured)}
              onClick={() =>
                run("source", () => call("/api/settings/data-source", { method: "PUT", body: { dataSource: o.id } }), "Data source updated.").then(onSaved)
              }
              className={`rounded-xl border p-3.5 text-left transition disabled:opacity-50 ${
                nowcerts.dataSource === o.id ? "border-brand-500 bg-brand-50" : "border-line hover:bg-surface-hover"
              }`}
            >
              <span className="block text-[13.5px] font-semibold text-ink-900">{o.title}</span>
              <span className="mt-0.5 block text-[12px] text-ink-500">{o.text}</span>
            </button>
          ))}
        </div>
        {!nowcerts.configured && <p className="text-[12px] text-ink-500">Connect NowCerts below to enable it.</p>}
      </Section>

      <DemoDataCard demo={demo} onSaved={onSaved} />

      <Section title="NowCerts connection" description="Use a NowCerts API user. CertFlow only reads from NowCerts; it never changes anything there.">
        {nowcerts.configured && (
          <Notice tone={nowcerts.lastSyncStatus === "error" ? "error" : "info"}>
            {nowcerts.lastSyncStatus === "error"
              ? `Last sync failed: ${nowcerts.lastSyncError}`
              : nowcerts.lastSyncAt
                ? `Last synced ${when(nowcerts.lastSyncAt)}${stats ? ` · ${stats.clients} clients, ${stats.coverageRows} coverage rows, ${stats.vehicles} vehicles` : ""}.`
                : "Connected. Not synced yet."}
          </Notice>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="NowCerts API username">
            <Input value={form.username} onChange={set("username")} autoComplete="off" />
          </Field>
          <Field label="Password" hint={nowcerts.passwordSet ? "Saved. Leave blank to keep it." : undefined}>
            <Input type="password" autoComplete="new-password" value={form.password} onChange={set("password")} placeholder={nowcerts.passwordSet ? "••••••••••••" : ""} />
          </Field>
          <Field label="Sync every">
            <Select value={form.syncIntervalMinutes} onChange={set("syncIntervalMinutes")}>
              {[15, 30, 60, 120, 240, 720, 1440].map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} minutes` : m === 60 ? "1 hour" : m === 1440 ? "24 hours" : `${m / 60} hours`}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button
            busy={busy === "save"}
            disabled={Boolean(busy)}
            onClick={() =>
              run("save", () => call("/api/settings/nowcerts", { method: "PUT", body: { ...form, test: true } }), (r) => r?.message || "Saved.").then(
                (r) => r && onSaved()
              )
            }
          >
            Test and save
          </Button>
          {nowcerts.configured && (
            <>
              <Button
                variant="secondary"
                busy={busy === "sync"}
                disabled={Boolean(busy)}
                onClick={() =>
                  run(
                    "sync",
                    () => call("/api/settings/nowcerts/sync", { method: "POST" }),
                    (r) => `Synced: ${r.stats.clients} clients, ${r.stats.coverageRows} coverage rows, ${r.stats.vehicles} vehicles.`
                  ).then(onSaved)
                }
              >
                Sync now
              </Button>
              <Button
                variant="danger"
                busy={busy === "remove"}
                disabled={Boolean(busy)}
                onClick={() =>
                  confirm("Disconnect NowCerts? Already-copied data stays; no further updates will arrive.") &&
                  run("remove", () => call("/api/settings/nowcerts", { method: "DELETE" }), "Disconnected.").then(onSaved)
                }
              >
                Disconnect
              </Button>
            </>
          )}
        </div>
      </Section>
    </div>
  );
}

/**
 * The demonstration clients and policies every agency starts with, so the
 * product can be shown working before real data exists. They are never touched
 * by a NowCerts sync, and removing them cannot affect real records.
 */
function DemoDataCard({ demo, onSaved }) {
  const { busy, notice, run } = useAction();
  if (!demo) return null;

  return (
    <Section
      title="Demonstration data"
      description="Sample trucking clients with policies and vehicles, so you can watch a request turn into a finished certificate before your real data is connected."
    >
      <Notice tone={demo.loaded ? "info" : "info"}>
        {demo.loaded
          ? `Loaded: ${demo.clients} sample client${demo.clients === 1 ? "" : "s"}, ${demo.policies} policies, ${demo.vehicles} vehicles. They are clearly fictional and are never sent anywhere on their own.`
          : "Not loaded. Your certificates will be built only from your own data."}
      </Notice>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={demo.loaded ? "secondary" : "primary"}
          busy={busy === "load"}
          disabled={Boolean(busy)}
          onClick={() =>
            run(
              "load",
              () => call("/api/settings/demo-data", { method: "POST", body: { action: "load" } }),
              (r) => `Sample data ready: ${r.demo.clients} clients, ${r.demo.policies} policies, ${r.demo.vehicles} vehicles.`
            ).then((r) => r && onSaved())
          }
        >
          {demo.loaded ? "Reload sample data" : "Load sample data"}
        </Button>
        {demo.loaded && (
          <Button
            variant="danger"
            busy={busy === "remove"}
            disabled={Boolean(busy)}
            onClick={() =>
              confirm("Remove the sample clients and policies? Your own data is not affected.") &&
              run(
                "remove",
                () => call("/api/settings/demo-data", { method: "POST", body: { action: "remove" } }),
                (r) =>
                  r.keptForCertificates
                    ? `Removed. ${r.keptForCertificates} sample client(s) were kept because a certificate refers to them, but they no longer match new requests.`
                    : "Sample data removed."
              ).then((r) => r && onSaved())
            }
          >
            Remove sample data
          </Button>
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- automation

function AutomationTab({ agency, onSaved }) {
  const { busy, notice, run } = useAction();
  return (
    <Section title="Sending certificates" description="What happens after CertFlow has prepared a certificate.">
      <Toggle
        checked={agency.autoSend}
        disabled={Boolean(busy)}
        onChange={(v) =>
          (!v || confirm("Turn on auto-send? Certificates for clearly identified clients will be issued and emailed with no one reviewing them.")) &&
          run("toggle", () => call("/api/settings/automation", { method: "PUT", body: { autoSend: v } }), v ? "Auto-send is on." : "Auto-send is off.").then(onSaved)
        }
        label="Send certificates automatically"
        hint="When on, a certificate is issued and emailed as soon as it is ready — but only when CertFlow identified the client with certainty (a clear name match, or a USDOT/MC number from the requester). Everything else still waits for a person."
      />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      <Notice tone="info">
        {agency.autoSend
          ? "On. Every automatic send is recorded in the audit log as sent by the system."
          : "Off. A reviewer approves and sends every certificate (recommended while you are getting started)."}
      </Notice>
    </Section>
  );
}

// ---------------------------------------------------------------- users

function UsersTab({ canManage }) {
  const [users, setUsers] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", role: "reviewer" });
  const [secret, setSecret] = useState(null);
  const { busy, notice, run } = useAction();

  const load = useCallback(() => {
    call("/api/users").then((b) => setUsers(b.users)).catch(() => setUsers([]));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="space-y-4">
      {!canManage && (
        <Notice tone="info">Users for your agency are managed by Nestnic. Contact support to add, remove or reset a user.</Notice>
      )}
      <OneTimeSecret label={secret?.label} value={secret?.value} onDone={() => setSecret(null)} />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <Section title="People with access">
        <div className="-mx-5 divide-y divide-line-soft">
          {(users || []).map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-ink-900">
                  {u.name} {u.status !== "active" && <span className="text-[11.5px] text-red-600">(disabled)</span>}
                </p>
                <p className="text-[12px] text-ink-500">
                  {u.email} · {u.role} · last sign-in {when(u.lastLoginAt)}
                </p>
              </div>
              {canManage && (
                <div className="flex gap-1.5">
                  <Button
                    variant="ghost"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      run("reset", () => call(`/api/users/${u.id}/reset`, { method: "POST" }), "New temporary password issued.").then(
                        (r) => r && setSecret({ label: `Temporary password for ${u.email}`, value: r.tempPassword })
                      )
                    }
                  >
                    Reset password
                  </Button>
                  <Button
                    variant={u.status === "active" ? "danger" : "secondary"}
                    disabled={Boolean(busy)}
                    onClick={() =>
                      run(
                        "status",
                        () => call(`/api/users/${u.id}`, { method: "PATCH", body: { status: u.status === "active" ? "disabled" : "active" } }),
                        "Updated."
                      ).then(load)
                    }
                  >
                    {u.status === "active" ? "Disable" : "Enable"}
                  </Button>
                </div>
              )}
            </div>
          ))}
          {users && !users.length && <p className="px-5 py-3 text-[13px] text-ink-500">No users.</p>}
        </div>
      </Section>

      {canManage && (
        <Section title="Add a user" description="They get a temporary password and must choose their own when they first sign in.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Role">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="reviewer">Reviewer — review and send certificates</option>
                <option value="admin">Admin — also settings and users</option>
                <option value="readonly">Read-only — view only</option>
              </Select>
            </Field>
          </div>
          <Button
            busy={busy === "add"}
            onClick={() =>
              run("add", () => call("/api/users", { method: "POST", body: form }), "User added.").then((r) => {
                if (!r) return;
                setSecret({ label: `Temporary password for ${r.email}`, value: r.tempPassword });
                setForm({ name: "", email: "", role: "reviewer" });
                load();
              })
            }
          >
            Add user
          </Button>
        </Section>
      )}
    </div>
  );
}
