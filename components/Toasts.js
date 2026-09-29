"use client";

/**
 * Corner notices, bottom right.
 *
 * There is exactly one thing this screen cannot otherwise tell a reviewer:
 * what auto-send did while they were looking at something else. The inbox row
 * records it either way — the toast is what makes it visible in the moment.
 *
 * Rendered once, by the shell, so a notice raised on the inbox survives a
 * click through to a certificate. It reads its own content from the store,
 * which built it from the authenticated request list; nothing here comes off
 * the event stream directly.
 */

import Link from "next/link";
import { useStore } from "@/lib/store";
import { Icon } from "@/components/icons";

const TONE = {
  success: {
    mark: "bg-emerald-50 text-emerald-600",
    edge: "border-emerald-200",
    Glyph: Icon.Check,
  },
  error: {
    mark: "bg-red-50 text-red-600",
    edge: "border-red-200",
    Glyph: Icon.Mail,
  },
};

export default function Toasts() {
  const { toasts, dismissToast } = useStore();
  if (!toasts?.length) return null;

  return (
    // aria-live so a screen reader hears it without the focus moving, and
    // pointer-events-none on the stack so an empty gap never swallows a click
    // aimed at the page underneath.
    <div
      role="status"
      aria-live="polite"
      className="no-print pointer-events-none fixed bottom-5 right-5 z-50 flex w-[348px] flex-col gap-2.5"
    >
      {toasts.map((toast) => {
        const tone = TONE[toast.tone] ?? TONE.success;
        const { Glyph } = tone;
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex gap-3 rounded-2xl border bg-white p-3.5 shadow-card animate-scale-in ${tone.edge}`}
          >
            <span className={`flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full ${tone.mark}`}>
              <Glyph width={14} height={14} strokeWidth={2} />
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-ink-900">{toast.title}</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-ink-500">{toast.body}</p>
              {toast.href && (
                <Link
                  href={toast.href}
                  onClick={() => dismissToast(toast.id)}
                  className="mt-2 inline-flex h-[26px] items-center rounded-[7px] bg-brand-500 px-2.5 text-[12px] font-semibold text-white transition hover:bg-brand-600"
                >
                  {toast.linkLabel}
                </Link>
              )}
            </div>

            <button
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss"
              className="flex h-6 w-6 flex-none items-center justify-center rounded-lg text-ink-300 transition hover:bg-surface-hover hover:text-ink-600"
            >
              <Icon.Close width={13} height={13} strokeWidth={2} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
