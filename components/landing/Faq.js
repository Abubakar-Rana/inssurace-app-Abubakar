"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { L, Logo } from "./icons";
import { PrimaryLink } from "./Nav";
import { Reveal, SectionHeading } from "./Reveal";

const FAQ = [
  {
    q: "Does CertFlow ever send a certificate on its own?",
    a: "No. Every certificate is a draft until a person on your team reviews it and clicks send. The only email CertFlow sends by itself is a short question to the requester when it needs to know which company they meant or who the certificate holder is — and that question contains no coverage details and no document.",
  },
  {
    q: "Where do the limits, policy numbers and dates come from?",
    a: "Only from your agency's own policy records. They are never taken from the request email, and never produced by AI.",
  },
  {
    q: "What happens when two of our clients have almost the same name?",
    a: "CertFlow doesn't pick one at random. It can match on a USDOT or MC number, and when the request still doesn't make it clear, it asks the requester which company they meant.",
  },
  {
    q: "How is AI used?",
    a: "Only where rule-based reading of the email fails. Any answer the AI gives must appear word for word in the email, or it is discarded — so it can point to what the requester wrote, but it can't invent a value.",
  },
  {
    q: "Will vehicle and VIN details appear on every certificate?",
    a: "No. Vehicles and VINs are printed only when the requester asks for them, so your insured's fleet details aren't shared by default.",
  },
  {
    q: "How is our data kept safe?",
    a: "Each agency's data is isolated at the database level, every action goes into a tamper-evident audit trail, and the text of request emails is deleted after 30 days.",
  },
];

function Item({ item, open, onToggle }) {
  const id = useId();
  return (
    <li className="border-b border-line">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          id={`${id}-button`}
          onClick={onToggle}
          className="group flex w-full items-center justify-between gap-6 rounded-lg py-5 text-left font-display text-base font-semibold text-ink-900 transition-colors hover:text-brand-650 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 sm:text-lg"
        >
          {item.q}
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-ink-600 transition-all duration-300 group-hover:border-brand-300 ${
              open ? "rotate-45 border-brand-300 bg-brand-50 text-brand-650" : ""
            }`}
          >
            <L.Plus className="h-4 w-4" />
          </span>
        </button>
      </h3>
      <div
        id={`${id}-panel`}
        role="region"
        aria-labelledby={`${id}-button`}
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden" inert={open ? undefined : ""}>
          <p className="pb-6 pr-12 text-[15px] leading-relaxed text-ink-600">{item.a}</p>
        </div>
      </div>
    </li>
  );
}

export function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <SectionHeading id="faq-title" eyebrow="FAQ" title="Questions agencies ask" />
        <Reveal delay={100}>
          <ul className="mt-12 border-t border-line">
            {FAQ.map((item, i) => (
              <Item key={item.q} item={item} open={open === i} onToggle={() => setOpen(open === i ? -1 : i)} />
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="px-4 pb-20 sm:px-6 sm:pb-28">
      <Reveal className="mx-auto max-w-6xl">
        <div className="relative overflow-hidden rounded-3xl bg-ink-950 px-6 py-14 text-center sm:px-12 sm:py-20">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_0%_0%,rgba(242,101,34,0.35),transparent_60%),radial-gradient(60%_80%_at_100%_100%,rgba(45,107,228,0.35),transparent_60%)]"
          />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:40px_40px]" />
          <div className="relative mx-auto max-w-2xl">
            <h2 id="cta-title" className="text-balance font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Stop typing certificates by hand.
            </h2>
            <p className="mt-4 text-pretty text-lg text-ink-300">
              Let CertFlow draft them from your records. Your team checks, and sends.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <PrimaryLink href="/signup">Get started</PrimaryLink>
              <Link
                href="/signin"
                className="inline-flex h-12 items-center justify-center rounded-xl px-6 text-[15px] font-semibold text-white ring-1 ring-white/20 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

const FOOTER = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "#how-it-works" },
      { label: "Features", href: "#features" },
      { label: "Security", href: "#security" },
      { label: "FAQ", href: "#faq" },
    ],
  },
  {
    title: "Company",
    // TODO: placeholder links — replace with real pages.
    links: [
      { label: "About [placeholder]", href: "#" },
      { label: "Contact [placeholder]", href: "#" },
    ],
  },
  {
    title: "Legal",
    // TODO: placeholder links — replace with real pages.
    links: [
      { label: "Privacy [placeholder]", href: "#" },
      { label: "Terms [placeholder]", href: "#" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-line bg-surface-sunken">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-600">
            ACORD 25 certificates of insurance, drafted from your records and sent by your team.
          </p>
        </div>
        {FOOTER.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h2 className="text-sm font-semibold text-ink-900">{col.title}</h2>
            <ul className="mt-4 space-y-3">
              {col.links.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    className="rounded text-sm text-ink-600 transition-colors hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-4 py-6 text-xs text-ink-500 sm:px-6">
          © CertFlow · Nestnic Solutions [placeholder — confirm legal name and year]
        </p>
      </div>
    </footer>
  );
}
