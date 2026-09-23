"use client";

import { HeroStory } from "./HeroStory";
import { L } from "./icons";
import { PrimaryLink } from "./Nav";
import { Reveal, SectionHeading } from "./Reveal";

/* ------------------------------------------------------------------ Hero */

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden">
      <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-0 -top-16" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-40 h-[520px] bg-[radial-gradient(40%_60%_at_20%_30%,rgba(242,101,34,0.10),transparent_70%),radial-gradient(40%_60%_at_85%_20%,rgba(45,107,228,0.10),transparent_70%)]"
      />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-12 pt-10 sm:px-6 sm:pb-20 sm:pt-16 lg:grid-cols-[1fr_1.05fr] lg:gap-10 lg:pb-28 lg:pt-20">
        <div className="max-w-xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-white/80 px-3 py-1 text-xs font-medium text-ink-700 shadow-card">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
            ACORD 25 certificates for trucking insurance agencies
          </p>
          <h1
            id="hero-title"
            className="mt-6 text-balance font-display text-[2.5rem] font-semibold leading-[1.05] tracking-tight text-ink-900 sm:text-5xl lg:text-[3.6rem]"
          >
            {/* Fixed line breaks except at sm-md: the fallback font and Inter Tight wrap
                this headline differently, and the swap shifted the page. */}
            <span className="block sm:inline lg:block">Stop typing </span>
            <span className="block sm:inline lg:block">certificates. </span>
            <span className="block w-fit bg-gradient-to-r from-brand-650 to-brand-500 bg-clip-text text-transparent sm:inline sm:w-auto lg:block lg:w-fit">
              <span className="block sm:inline lg:block">Check them </span>
              <span className="block sm:inline lg:block">and send.</span>
            </span>
          </h1>
          <p className="mt-6 text-pretty text-lg leading-relaxed text-ink-600">
            CertFlow reads certificate requests in your inbox, finds the insured, and drafts the ACORD 25 from your own
            policy records. A person on your team reviews it and sends it with one click.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <PrimaryLink href="/signup">Get started</PrimaryLink>
            <a
              href="#how-it-works"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-line bg-white px-6 text-[15px] font-semibold text-ink-800 transition-all duration-200 hover:-translate-y-px hover:border-ink-300 hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2"
            >
              See how it works
            </a>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-600">
            {["Nothing sent without a person", "Values from your records", "Data isolated per agency"].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <L.Check className="h-4 w-4 text-emerald-600" />
                {t}
              </li>
            ))}
          </ul>
        </div>

        <HeroStory />
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- How it works */

const STEPS = [
  {
    icon: L.Mail,
    title: "A request arrives",
    body: "A broker, shipper or carrier emails your agency inbox asking for a certificate of insurance.",
  },
  {
    icon: L.Search,
    title: "CertFlow finds the insured",
    body: "It identifies the insured company — by name, or by USDOT or MC number — even when two of your clients have near-identical names.",
  },
  {
    icon: L.Question,
    title: "It asks for anything missing",
    body: "Unsure which company, or who the certificate holder is? It emails the requester one short question and reads the reply.",
  },
  {
    icon: L.Document,
    title: "The ACORD 25 is drafted",
    body: "A pixel-perfect certificate built from your policy records. Limits, policy numbers and dates never come from the email or the AI.",
  },
  {
    icon: L.UserCheck,
    title: "You review and send",
    body: "A person checks the draft and sends it with one click. Nothing is ever sent automatically.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 border-t border-line-soft bg-surface-sunken py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          id="how-title"
          eyebrow="How it works"
          title="From inbox to certificate, with a person at the end"
          lede="The typing is automated. The judgement stays with your team."
        />

        <ol className="relative mt-14 grid gap-6 lg:mt-16 lg:grid-cols-5 lg:gap-4">
          {/* connecting line: vertical on mobile, horizontal on desktop */}
          <span aria-hidden="true" className="absolute bottom-8 left-[27px] top-8 w-px bg-gradient-to-b from-brand-300 via-line to-accent-300 lg:hidden" />
          <span aria-hidden="true" className="absolute left-[10%] right-[10%] top-[27px] hidden h-px bg-gradient-to-r from-brand-300 via-line to-accent-300 lg:block" />

          {STEPS.map((s, i) => (
            <Reveal as="li" key={s.title} delay={i * 80} className="relative flex gap-4 lg:flex-col lg:items-center lg:text-center">
              <span className="relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-line bg-white text-ink-800 shadow-card">
                <s.icon className="h-6 w-6" />
                <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink-900 font-code text-[10px] font-medium text-white">
                  {i + 1}
                </span>
              </span>
              <div className="pt-1 lg:pt-3">
                <h3 className="font-display text-base font-semibold text-ink-900">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- Features */
// Card treatment adapted from 21st.dev "Feature Grid Spotlight Cards"
// (hirael, MIT): hairline grid, corner crosshairs, pointer-follow spotlight.

const FEATURES = [
  {
    icon: L.Hash,
    title: "Insured matching by DOT and MC",
    body: "Finds the right client from a name or a USDOT or MC number. When two clients look alike, it asks rather than guesses.",
  },
  {
    icon: L.Question,
    title: "Asks the requester, once",
    body: "Missing the company or the certificate holder? One short automatic question to the requester, and their reply is read for you.",
  },
  {
    icon: L.Database,
    title: "Certificate data from your records",
    body: "Limits, policy numbers and dates come only from your agency's policy records — never from the email, never from AI.",
  },
  {
    icon: L.Truck,
    title: "VINs only when asked for",
    body: "Vehicles are printed only when the requester asks for them, so your insured's fleet details aren't shared by default.",
  },
  {
    icon: L.UserCheck,
    title: "Human approval before send",
    body: "Every certificate is a draft until a person reviews it. Sending is one click — and it is always a person's click.",
  },
  {
    icon: L.Pulse,
    title: "A live dashboard",
    body: "New requests appear on the dashboard within seconds of arriving. No refreshing, no checking the inbox.",
  },
];

function Cross({ className }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`pointer-events-none absolute z-10 h-3.5 w-3.5 text-ink-300 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <path d="M5 12h14M12 5v14" />
    </svg>
  );
}

function FeatureCard({ feature, delay }) {
  const onPointerMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <Reveal as="li" delay={delay} className="h-full">
      <div onPointerMove={onPointerMove} className="group relative flex h-full flex-col gap-5 bg-white px-6 pb-7 pt-8">
        <div aria-hidden="true" className="spotlight pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <span aria-hidden="true" className="absolute -inset-y-3 -left-px w-px bg-line" />
        <span aria-hidden="true" className="absolute -inset-y-3 -right-px w-px bg-line" />
        <span aria-hidden="true" className="absolute -inset-x-3 -top-px h-px bg-line" />
        <span aria-hidden="true" className="absolute -inset-x-3 -bottom-px h-px bg-line" />
        <Cross className="left-0 top-0 -translate-x-1/2 -translate-y-1/2" />
        <Cross className="bottom-0 right-0 translate-x-1/2 translate-y-1/2" />

        <span className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-sunken text-ink-800 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:border-brand-300 group-hover:text-brand-650">
          <feature.icon className="h-5 w-5" />
        </span>
        <div className="relative">
          <h3 className="font-display text-base font-semibold text-ink-900">{feature.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-600">{feature.body}</p>
        </div>
      </div>
    </Reveal>
  );
}

export function Features() {
  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          id="features-title"
          eyebrow="Features"
          title="Built for the way COI requests really arrive"
          lede="Vague emails, look-alike client names, missing holders. CertFlow handles the untidy parts and leaves the decision to you."
        />
        <ul className="mx-auto mt-14 grid max-w-6xl grid-cols-1 gap-6 px-2 sm:px-0 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <FeatureCard key={f.title} feature={f} delay={(i % 3) * 80} />
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ AI section */

const AI_RULES = [
  {
    title: "Rules first, AI only in the gaps",
    body: "Rule-based reading handles the request whenever it can. AI is consulted only where those rules come back empty.",
  },
  {
    title: "It can never invent a value",
    body: "Every answer the AI gives must appear word for word in the email. Anything that doesn't is thrown away.",
  },
  {
    title: "It reads — your records decide",
    body: "The AI can point to a company name or a number in the email. Limits, policy numbers and dates still come only from your records.",
  },
];

export function TrustAI() {
  return (
    <section id="ai" aria-labelledby="ai-title" className="scroll-mt-20 border-t border-line-soft bg-surface-sunken py-20 sm:py-28">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-2">
        <div>
          <SectionHeading
            id="ai-title"
            align="left"
            eyebrow="AI you can trust"
            title="AI that fills gaps — and shows its work"
            lede="An AI that makes things up has no place on a certificate of insurance. So CertFlow's is kept on a short leash."
          />
          <ul className="mt-10 space-y-6">
            {AI_RULES.map((r, i) => (
              <Reveal as="li" key={r.title} delay={i * 90} className="flex gap-4">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                  <L.Check className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="font-display text-base font-semibold text-ink-900">{r.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-600 sm:text-[15px]">{r.body}</p>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>

        <Reveal delay={120}>
          <div className="relative rounded-2xl border border-line bg-white p-5 shadow-pop sm:p-7">
            <p className="flex items-center gap-2 font-code text-[11px] uppercase tracking-wider text-ink-500">
              <L.Quote className="h-4 w-4" /> The requester&apos;s email
            </p>
            <blockquote className="mt-4 text-[15px] leading-relaxed text-ink-700">
              &ldquo;Could you send over a certificate for{" "}
              <mark className="rounded bg-brand-100 px-1 text-ink-900 underline decoration-brand-500 decoration-2 underline-offset-4">
                Smart Way Solutions
              </mark>
              ? Please make it out to{" "}
              <mark className="rounded bg-accent-100 px-1 text-ink-900 underline decoration-accent-500 decoration-2 underline-offset-4">
                Keystone Brokerage
              </mark>
              .&rdquo;
            </blockquote>

            <div className="mt-6 space-y-2.5 border-t border-line-soft pt-5">
              <Check label="Insured" value="Smart Way Solutions" ok="found word for word" />
              <Check label="Holder" value="Keystone Brokerage" ok="found word for word" />
              <div className="flex flex-col gap-1 rounded-lg bg-red-50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span className="min-w-0">
                  <span className="font-code text-[11px] uppercase tracking-wider text-red-800">Rejected</span>
                  <span className="ml-2 text-ink-800 line-through decoration-red-400">Smart Way Solutions LLC</span>
                </span>
                <span className="shrink-0 text-xs text-red-800">not in the email</span>
              </div>
            </div>
            <p className="mt-4 text-center font-code text-[10px] text-ink-500">Illustrative example</p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Check({ label, value, ok }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <span className="min-w-0">
        <span className="font-code text-[11px] uppercase tracking-wider text-emerald-800">{label}</span>
        <span className="ml-2 font-medium text-ink-900">{value}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-xs text-emerald-800">
        <L.Check className="h-3.5 w-3.5" />
        {ok}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------- Security */

const SECURITY = [
  {
    icon: L.Layers,
    title: "Each agency's data, isolated",
    body: "Isolation is enforced by the database itself, not just by the application — one agency's records cannot be read in another's session.",
  },
  {
    icon: L.Chain,
    title: "A tamper-evident audit trail",
    body: "Every draft, approval and send is recorded in an audit log where each entry is chained to the last, so changes to history show.",
  },
  {
    icon: L.Clock,
    title: "Email text deleted after 30 days",
    body: "The text of request emails is kept only as long as it's useful, then deleted automatically.",
  },
];

export function Security() {
  return (
    <section id="security" aria-labelledby="security-title" className="relative scroll-mt-20 overflow-hidden bg-ink-950 py-20 sm:py-28">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_60%_at_15%_0%,rgba(242,101,34,0.16),transparent_70%),radial-gradient(45%_60%_at_100%_100%,rgba(45,107,228,0.2),transparent_70%)]"
      />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          id="security-title"
          dark
          eyebrow="Security"
          title="Your clients' insurance data, handled carefully"
          lede="Certificates carry policy details your insureds trust you with. CertFlow is built around keeping them that way."
        />
        <ul className="mt-14 grid gap-4 md:grid-cols-3">
          {SECURITY.map((s, i) => (
            <Reveal as="li" key={s.title} delay={i * 90}>
              <div className="h-full rounded-2xl border border-white/10 bg-white/[0.04] p-6 transition-colors duration-300 hover:border-white/20 hover:bg-white/[0.07]">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-brand-300 ring-1 ring-white/10">
                  <s.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 font-display text-base font-semibold text-white">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-300">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
