"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

const STEPS = [
  { icon: Icon.Mail, label: "Reading inbound email thread", detail: "Parsing message from certificate requester" },
  { icon: Icon.Doc, label: "Extracting holder & requested coverages", detail: "Certificate holder, address, coverage lines" },
  { icon: Icon.Database, label: "Matching insured in AMS360", detail: "Locating client record & policy file" },
  { icon: Icon.Shield, label: "Pulling active policies & limits", detail: "Carriers, NAIC, effective / expiration dates" },
  { icon: Icon.Sparkle, label: "Auto-filling ACORD 25 certificate", detail: "Mapping data into the certificate form" },
];

export default function ProcessingModal({ request, onComplete, onCancel }) {
  const [active, setActive] = useState(0);
  const [done, setDone] = useState(false);
  const completedRef = useRef(false);

  useEffect(() => {
    const timers = [];
    STEPS.forEach((_, i) => {
      timers.push(setTimeout(() => setActive(i + 1), 620 * (i + 1)));
    });
    timers.push(
      setTimeout(() => {
        setDone(true);
      }, 620 * STEPS.length + 400)
    );
    timers.push(
      setTimeout(() => {
        if (!completedRef.current) {
          completedRef.current = true;
          onComplete();
        }
      }, 620 * STEPS.length + 1150)
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg animate-scale-in overflow-hidden rounded-2xl bg-white shadow-pop">
        <div className="relative bg-gradient-to-br from-brand-500 to-brand-600 px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20">
              <Icon.Bolt width={22} height={22} />
            </span>
            <div>
              <h3 className="text-lg font-bold leading-tight">Generating Certificate</h3>
              <p className="text-sm text-white/85">
                {request.ams.clientName} · {request.id}
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5">
          <ul className="space-y-1.5">
            {STEPS.map((s, i) => {
              const state = i < active ? "done" : i === active ? "running" : "pending";
              const I = s.icon;
              return (
                <li
                  key={i}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${
                    state === "running" ? "bg-brand-50" : ""
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg transition
                      ${state === "done" ? "bg-emerald-500 text-white" : ""}
                      ${state === "running" ? "bg-brand-500 text-white" : ""}
                      ${state === "pending" ? "bg-ink-900/5 text-ink-400" : ""}`}
                  >
                    {state === "done" ? (
                      <Icon.Check width={17} height={17} />
                    ) : state === "running" ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    ) : (
                      <I width={16} height={16} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-semibold ${state === "pending" ? "text-ink-400" : "text-ink-900"}`}>
                      {s.label}
                    </p>
                    <p className="truncate text-[12px] text-ink-500">{s.detail}</p>
                  </div>
                  {state === "done" && (
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Done</span>
                  )}
                </li>
              );
            })}
          </ul>

          {done && (
            <div className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-emerald-50 py-3 text-sm font-semibold text-emerald-700 animate-fade-up">
              <Icon.Check width={18} height={18} /> ACORD 25 filled — opening editor…
            </div>
          )}
        </div>

        {!done && (
          <div className="border-t border-ink-900/5 px-6 py-3 text-center">
            <button onClick={onCancel} className="text-sm font-medium text-ink-500 hover:text-ink-800">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
