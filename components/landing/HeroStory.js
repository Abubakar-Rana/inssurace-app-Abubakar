"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { L } from "./icons";

/**
 * The hero's product story, in HTML and CSS: a request email arrives, the two
 * phrases that matter are picked out, and a certificate fills itself in until
 * it stops at "Review & send".
 *
 * Every element is rendered from the first paint and only its opacity,
 * transform, clip or visibility changes, so nothing shifts the layout. Text
 * that appears mid-story slides in rather than fading: half-transparent text
 * fails a contrast check made at that moment, and a fast load is checked
 * mid-story every time. With reduced motion
 * the story starts on its last frame. All values are illustrative.
 */

// [step, ms after start]
const TIMELINE = [300, 1200, 1750, 2400, 3050, 3500, 3950, 4600, 5400];
const LAST = TIMELINE.length;

const STATUS = [
  "Waiting for mail",
  "Reading the request",
  "Reading the request",
  "Reading the request",
  "Matched insured in your records",
  "Filling from your policy records",
  "Filling from your policy records",
  "Filling from your policy records",
  "Holder taken from the email",
  "Draft ready for review",
];

const COVERAGES = [
  { type: "Commercial general liability", policy: "GL-0418-26", eff: "01/01/2026", exp: "01/01/2027", limit: "$1,000,000" },
  { type: "Automobile liability", policy: "CA-1177-26", eff: "01/01/2026", exp: "01/01/2027", limit: "$1,000,000" },
  { type: "Motor truck cargo", policy: "MTC-0932-26", eff: "01/01/2026", exp: "01/01/2027", limit: "$100,000" },
];

export function HeroStory() {
  const [step, setStep] = useState(0);
  const timers = useRef([]);

  const play = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setStep(LAST);
      return;
    }
    setStep(0);
    TIMELINE.forEach((ms, i) => {
      timers.current.push(setTimeout(() => setStep(i + 1), ms));
    });
  }, []);

  useEffect(() => {
    play();
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, [play]);

  const at = (n) => step >= n;
  const done = step >= LAST;

  return (
    <figure className="relative mx-auto w-full max-w-[560px]">
      <figcaption className="sr-only">
        Illustration: an email asking for a certificate of insurance for Smart Way Solutions, with Keystone Brokerage as
        the holder, becomes a drafted ACORD 25 certificate whose policy numbers, dates and limits come from the agency&apos;s
        records, ending on a Review and send button.
      </figcaption>

      {/* Soft glow behind the stage */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-8 -z-10 rounded-[3rem] bg-[radial-gradient(60%_50%_at_30%_20%,rgba(242,101,34,0.18),transparent_70%),radial-gradient(55%_50%_at_80%_80%,rgba(45,107,228,0.16),transparent_70%)]"
      />

      <div aria-hidden="true">
        {/* ---- The email ---- */}
        <div
          className={`relative z-20 w-[92%] rounded-2xl border border-line bg-white/95 p-4 shadow-pop backdrop-blur transition-all duration-700 ease-out sm:w-[80%] sm:p-5 ${
            at(1) ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0"
          }`}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-50 text-accent-600">
              <L.Mail className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[13px] font-semibold text-ink-900">Keystone Brokerage</p>
                <p className="shrink-0 font-code text-[11px] text-ink-600">just now</p>
              </div>
              <p className="truncate text-[12px] text-ink-600">COI request</p>
            </div>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-700 sm:text-sm">
            Hi — Need a COI for{" "}
            <span
              className={`mark px-0.5 font-medium text-ink-900 [background-image:linear-gradient(rgba(242,101,34,0.22),rgba(242,101,34,0.22))] ${
                at(2) ? "on" : ""
              }`}
            >
              Smart Way Solutions
            </span>
            , holder:{" "}
            <span
              className={`mark px-0.5 font-medium text-ink-900 [background-image:linear-gradient(rgba(45,107,228,0.2),rgba(45,107,228,0.2))] ${
                at(3) ? "on" : ""
              }`}
            >
              Keystone Brokerage
            </span>
            . Thanks!
          </p>
        </div>

        {/* ---- The certificate ---- */}
        <div
          className={`relative z-10 -mt-6 ml-auto w-[96%] overflow-hidden rounded-2xl border border-line bg-white shadow-pop transition-all duration-700 ease-out sm:-mt-8 sm:w-[90%] ${
            at(1) ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
          }`}
          style={{ transitionDelay: at(1) ? "150ms" : "0ms" }}
        >
          {/* status bar */}
          <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-shell px-4 pb-2.5 pt-9 sm:pt-11">
            <span className="flex min-w-0 items-center gap-2">
              <span className="relative flex h-2 w-2 shrink-0">
                <span
                  className={`absolute inset-0 rounded-full ${done ? "bg-emerald-500" : "animate-breathe bg-brand-500"}`}
                />
              </span>
              <span key={STATUS[step]} className="status-in truncate font-code text-[11px] text-ink-700">
                {STATUS[step]}
              </span>
            </span>
            <span className="shrink-0 font-code text-[10px] uppercase tracking-wider text-ink-600">ACORD 25</span>
          </div>

          <div className="p-3 sm:p-4">
            <div className="flex items-end justify-between border-b-2 border-ink-900 pb-1.5">
              <p className="font-display text-[11px] font-bold uppercase leading-tight tracking-wide text-ink-900 sm:text-[13px]">
                Certificate of liability insurance
              </p>
              <p className="font-code text-[9px] text-ink-600">DATE 09/17/2026</p>
            </div>

            {/* producer / insured */}
            <div className="grid grid-cols-2 border-x border-b border-ink-300/70">
              <Cell label="Producer">
                <span className="text-ink-600">Your agency</span>
              </Cell>
              <Cell label="Insured" className="border-l border-ink-300/70" tag={at(4) ? "matched" : null} tone="brand">
                <span className={`fill font-semibold text-ink-900 ${at(4) ? "on" : ""}`}>Smart Way Solutions</span>
              </Cell>
            </div>

            {/* coverages */}
            <div className="border-x border-b border-ink-300/70">
              <div className="grid grid-cols-[1.5fr_1fr_1fr] gap-2 border-b border-ink-300/70 bg-surface-shell px-2 py-1 font-code text-[8px] uppercase tracking-wider text-ink-600 sm:grid-cols-[1.6fr_1fr_0.9fr_0.9fr]">
                <span>Type of insurance</span>
                <span>Policy number</span>
                <span className="hidden sm:block">Policy exp</span>
                <span className="text-right">Limit</span>
              </div>
              {COVERAGES.map((c, i) => {
                const on = at(5 + i);
                return (
                  <div
                    key={c.type}
                    className={`grid grid-cols-[1.5fr_1fr_1fr] items-center gap-2 px-2 py-1.5 text-[10px] transition-colors duration-500 sm:grid-cols-[1.6fr_1fr_0.9fr_0.9fr] sm:text-[11px] ${
                      i < COVERAGES.length - 1 ? "border-b border-line-soft" : ""
                    } ${on && step === 5 + i ? "bg-brand-50" : ""}`}
                  >
                    <span className="truncate text-ink-700">{c.type}</span>
                    <span className={`fill truncate font-code text-ink-900 ${on ? "on" : ""}`}>{c.policy}</span>
                    <span className="hidden truncate sm:block">
                      <span className={`fill font-code text-ink-900 ${on ? "on" : ""}`}>{c.exp}</span>
                    </span>
                    <span className={`fill truncate text-right font-code text-ink-900 ${on ? "on" : ""}`}>{c.limit}</span>
                  </div>
                );
              })}
            </div>

            {/* records badge */}
            <div className="flex h-7 items-center">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 font-code text-[10px] text-emerald-800 transition-all duration-500 ${
                  at(5) ? "visible translate-y-0 scale-100" : "invisible translate-y-1 scale-90"
                }`}
              >
                <L.Database className="h-3 w-3" />
                from your policy records
              </span>
            </div>

            {/* holder / action */}
            <div className="grid grid-cols-[1.1fr_1fr] items-stretch gap-3">
              <div className="border border-ink-300/70">
                <Cell label="Certificate holder" tag={at(8) ? "from email" : null} tone="accent">
                  <span className={`fill font-semibold text-ink-900 ${at(8) ? "on" : ""}`}>Keystone Brokerage</span>
                </Cell>
              </div>
              <div className="flex flex-col justify-end">
                <span
                  className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand-650 px-3 text-[12px] font-semibold text-white transition-all duration-500 sm:text-[13px] ${
                    done ? "ring-once visible translate-y-0 scale-100" : "invisible translate-y-1 scale-90"
                  }`}
                >
                  <L.Send className="h-3.5 w-3.5" />
                  Review &amp; send
                </span>
              </div>
            </div>

            <p className="mt-3 text-center font-code text-[9px] text-ink-600">Illustrative values</p>
          </div>
        </div>
      </div>

      <div className="mt-3 flex h-9 justify-end">
        <button
          type="button"
          onClick={play}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-ink-600 hover:bg-surface-hover hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
            done ? "visible" : "invisible"
          }`}
          tabIndex={done ? 0 : -1}
        >
          <L.Replay className="h-3.5 w-3.5" />
          Replay animation
        </button>
      </div>
    </figure>
  );
}

function Cell({ label, children, className = "", tag, tone }) {
  return (
    <div className={`relative min-h-[46px] px-2 py-1.5 ${className}`}>
      <div className="flex items-center justify-between gap-1">
        <span className="font-code text-[8px] uppercase tracking-wider text-ink-600">{label}</span>
        <span
          className={`whitespace-nowrap rounded px-1 font-code text-[8px] transition-all duration-300 ${
            tone === "accent" ? "bg-accent-50 text-accent-600" : "bg-brand-50 text-brand-700"
          } ${tag ? "visible scale-100" : "invisible scale-75"}`}
        >
          {tag || "·"}
        </span>
      </div>
      <div className="mt-1 truncate text-[11px] sm:text-[12px]">{children}</div>
    </div>
  );
}
