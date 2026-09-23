"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import { signOut, useStore } from "@/lib/store";

function initials(name) {
  if (!name) return "··";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

function NavItem({ href, icon: I, label, active, count }) {
  return (
    <Link
      href={href}
      className={`flex h-[34px] items-center gap-[11px] rounded-[7px] px-2.5 text-[13.5px] transition ${
        active ? "bg-[#e8eaee] font-semibold text-ink-900" : "font-medium text-ink-600 hover:bg-[#eef0f3]"
      }`}
    >
      <I width={17} height={17} />
      <span className="flex-1">{label}</span>
      {count ? <span className="text-[12px] font-semibold text-ink-600">{count}</span> : null}
    </Link>
  );
}

/**
 * Whether this screen is actually current.
 *
 * Stated plainly and quietly: a server-side watcher holds one connection to
 * the mailbox open, and this is the readout of it. It gets no colour, because
 * a green light for "working normally" is decoration — what matters is that a
 * DROPPED feed cannot look like a quiet mailbox.
 */
function FeedState({ live, mailbox }) {
  const noInbox = mailbox && !mailbox.configured;
  const label = noInbox
    ? "No inbox connected"
    : live === "live"
      ? "Watching mailbox"
      : live === "connecting"
        ? "Connecting…"
        : "Reconnecting…";
  const title =
    live === "live"
      ? "The server is watching the mailbox and pushing changes to this screen."
      : live === "connecting"
        ? "Connecting to the live feed."
        : "The live feed dropped. Reconnecting automatically — the list still refreshes on its own, just more slowly.";

  return (
    <div
      title={title}
      className="flex h-10 items-center gap-2 border-t border-line px-5 text-[11.5px] text-ink-500"
    >
      <span
        className={`h-1.5 w-1.5 flex-none rounded-full ${
          live === "offline" ? "bg-ink-300" : "bg-ink-600"
        } ${live === "live" ? "motion-safe:animate-breathe" : "motion-safe:animate-pulse"}`}
      />
      {label}
    </div>
  );
}

export default function AppShell({ children, inboxCount = 0 }) {
  const pathname = usePathname();
  const store = useStore();
  const [user, setUser] = useState(null);
  const [mailbox, setMailbox] = useState(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!body) return;
        // Server routes already refuse a temporary password; this just takes
        // the user straight to the one screen that still works for them.
        if (body.user?.mustChangePassword) {
          window.location.href = "/account/password";
          return;
        }
        setUser(body.user);
        // Whether this agency has an inbox yet — drives the onboarding banner.
        fetch("/api/mail/status")
          .then((r) => (r.ok ? r.json() : null))
          .then((m) => m && setMailbox(m))
          .catch(() => {});
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* ───────────────────────── sidebar ───────────────────────── */}
      <aside className="no-print hidden w-[232px] flex-none flex-col border-r border-line bg-surface-shell lg:flex">
        <Link href="/inbox" className="flex h-14 items-center gap-2.5 px-[18px]">
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-brand-500 text-white">
            <Icon.Shield width={15} height={15} strokeWidth={2} />
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink-900">CertFlow</span>
        </Link>

        {/* Only destinations that exist. A nav item that goes nowhere is worse
            than a shorter nav. */}
        <nav className="flex flex-col gap-px px-2.5 py-2">
          <NavItem href="/inbox" icon={Icon.Inbox} label="Inbox" active={pathname === "/inbox"} count={inboxCount} />
          <NavItem
            href="/certificates"
            icon={Icon.Doc}
            label="Certificates"
            active={pathname.startsWith("/certificates")}
          />
          {user?.role === "admin" && (
            <NavItem href="/settings" icon={Icon.Settings} label="Settings" active={pathname.startsWith("/settings")} />
          )}
        </nav>

        <div className="flex-1" />

        <FeedState live={store.live} mailbox={mailbox} />

        <div className="flex items-center gap-2.5 px-3.5 pb-3.5 pt-2.5">
          <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-[#e0e3e8] text-[10.5px] font-semibold text-ink-600">
            {initials(user?.name)}
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[12px] font-medium text-ink-700">{user?.name || "…"}</p>
            <p className="truncate text-[11px] text-ink-400">{user?.tenantName || user?.email || ""}</p>
            <Link href="/account/password" className="text-[11px] text-ink-400 hover:text-ink-700">
              Change password
            </Link>
          </div>
          <button
            onClick={signOut}
            title="Sign out"
            className="ml-auto flex h-7 w-7 flex-none items-center justify-center rounded-md text-ink-400 transition hover:bg-[#e8eaee] hover:text-ink-700"
          >
            <Icon.Chevron width={15} height={15} />
          </button>
        </div>
      </aside>

      {/* ───────────────────────── main column ───────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Deliberately thin. The screen's content carries the work; the bar
            carries identity and how much is unlooked-at. */}
        <header className="no-print flex h-14 flex-none items-center gap-4 border-b border-line px-[22px]">
          <Link href="/inbox" className="flex items-center gap-2.5 lg:hidden">
            <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-brand-500 text-white">
              <Icon.Shield width={15} height={15} strokeWidth={2} />
            </span>
            <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink-900">CertFlow</span>
          </Link>

          <div className="flex-1" />

          {/* The only number here that means "work you have not looked at". */}
          {store.unreadCount > 0 && (
            <span
              className="text-[12.5px] text-ink-500"
              title="Requests nobody has opened yet. Opening one clears it."
            >
              {store.unreadCount} unread
            </span>
          )}
          {/* The avatar lives in the sidebar on desktop, so both it and its
              divider are mobile-only — otherwise the bar ends on a rule with
              nothing after it. */}
          <span className="h-[18px] w-px bg-line lg:hidden" />
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[#e0e3e8] text-[10.5px] font-semibold text-ink-600 lg:hidden">
            {initials(user?.name)}
          </span>
        </header>

        {/* Scrolls. The inbox fills exactly this box and scrolls its own list
            inside it, so no outer bar appears there — but a document page is
            taller than the window and must be able to move. `overflow-hidden`
            here silently trapped the certificate pages. */}
        {pathname === "/inbox" && <InboxBanner mailbox={mailbox} />}
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

/**
 * Onboarding: until the agency's inbox is connected, nothing arrives, so the
 * inbox page says so and — for an admin — offers the one click that fixes it.
 * Also surfaces a connected inbox that has stopped working (for example,
 * access revoked in Google), which would otherwise look like a quiet day.
 */
function InboxBanner({ mailbox }) {
  if (!mailbox) return null;
  const broken = mailbox.configured && mailbox.lastError;
  if (mailbox.configured && !broken) return null;

  const text = !mailbox.configured
    ? mailbox.canConnect
      ? "Connect your agency's inbox to start receiving certificate requests automatically. It takes about a minute."
      : "Your agency's inbox is not connected yet, so no requests can arrive. Ask your agency admin to connect it in Settings."
    : `There is a problem with the inbox ${mailbox.account}: ${mailbox.lastError}`;

  return (
    <div
      className={`no-print flex flex-wrap items-center gap-3 border-b px-[22px] py-3 text-[13px] ${
        broken ? "border-red-100 bg-red-50 text-red-800" : "border-brand-100 bg-brand-50 text-ink-800"
      }`}
    >
      <Icon.Mail width={17} height={17} />
      <span className="min-w-0 flex-1">{text}</span>
      {mailbox.canConnect && (
        <Link
          href="/settings?tab=email"
          className="rounded-lg bg-brand-500 px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-brand-600"
        >
          {broken ? "Fix in Settings" : "Connect inbox"}
        </Link>
      )}
    </div>
  );
}
