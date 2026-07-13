"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";

function NavItem({ href, icon: I, label, active, badge }) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition
        ${active ? "bg-brand-500 text-white shadow-sm" : "text-ink-600 hover:bg-white hover:text-ink-900"}`}
    >
      <I className={active ? "text-white" : "text-ink-500 group-hover:text-brand-500"} width={19} height={19} />
      <span className="flex-1">{label}</span>
      {badge ? (
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            active ? "bg-white/25 text-white" : "bg-brand-100 text-brand-700"
          }`}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white shadow-sm">
        <Icon.Shield width={20} height={20} />
      </span>
      <span className="text-[19px] font-bold tracking-tight text-ink-900">
        Cert<span className="text-brand-500">Flow</span>
      </span>
    </Link>
  );
}

export default function AppShell({ children, inboxCount = 0 }) {
  const pathname = usePathname();
  const onInbox = pathname === "/";

  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      if (localStorage.getItem("certflow.collapsed") === "1") setCollapsed(true);
    } catch (e) {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem("certflow.collapsed", collapsed ? "1" : "0");
    } catch (e) {
      /* ignore */
    }
  }, [collapsed, mounted]);

  return (
    <div className="min-h-screen">
      {/* Sidebar */}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-30 w-64 flex-col border-r border-ink-900/5 bg-[#eef1f8] px-4 py-5 transition-transform duration-300 ${
          collapsed ? "hidden" : "hidden lg:flex"
        }`}
      >
        <div className="mb-7 flex items-center justify-between px-1">
          <Logo />
          <button
            onClick={() => setCollapsed(true)}
            title="Collapse sidebar"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 transition hover:bg-white hover:text-ink-800"
          >
            <Icon.Chevron width={17} height={17} className="rotate-180" />
          </button>
        </div>

        <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Workspace</p>
        <nav className="flex flex-col gap-1">
          <NavItem href="/" icon={Icon.Inbox} label="Request Inbox" active={onInbox} badge={inboxCount || undefined} />
          <NavItem href="/" icon={Icon.Doc} label="Certificates" active={false} />
          <NavItem href="/" icon={Icon.Send} label="Distributions" active={false} />
          <NavItem href="/" icon={Icon.Database} label="AMS Sync" active={false} />
        </nav>

        <div className="mt-auto rounded-2xl bg-white p-4 shadow-card">
          <div className="mb-1.5 flex items-center gap-2 text-brand-600">
            <Icon.Sparkle width={16} height={16} />
            <span className="text-xs font-bold uppercase tracking-wide">Prototype</span>
          </div>
          <p className="text-[12px] leading-snug text-ink-600">
            Triggers &amp; AMS data are simulated. Editing &amp; distribution flows are fully functional.
          </p>
        </div>
      </aside>

      {/* Main column */}
      <div className={`transition-[padding] duration-300 ${collapsed ? "" : "lg:pl-64"}`}>
        {/* Topbar */}
        <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-ink-900/5 bg-white/80 px-4 backdrop-blur sm:px-5">
          {/* Fold / unfold toggle (desktop) */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-ink-500 transition hover:bg-ink-900/5 hover:text-ink-800 lg:inline-flex"
          >
            <Icon.PanelLeft width={19} height={19} />
          </button>

          {/* Logo: always on mobile, on desktop only when collapsed */}
          <div className={`flex items-center ${collapsed ? "lg:flex" : "lg:hidden"}`}>
            <Logo />
          </div>

          <div className="ml-1 hidden items-center gap-2 rounded-full bg-ink-900/5 px-3.5 py-1.5 text-sm text-ink-500 sm:flex">
            <Icon.Database width={15} height={15} className="text-emerald-500" />
            <span className="font-medium text-ink-700">AMS360</span>
            <span className="text-ink-400">·</span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Connected
            </span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full bg-ink-900/5 px-3 py-1.5 text-sm text-ink-600 md:flex">
              <Icon.Mail width={15} height={15} className="text-brand-500" />
              <span className="font-medium">coi@newhopeins.com</span>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-bold text-white">
                AM
              </div>
              <div className="hidden leading-tight sm:block">
                <p className="text-sm font-semibold text-ink-900">Axel Moreno</p>
                <p className="text-[11px] text-ink-500">Commercial Lines</p>
              </div>
            </div>
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
