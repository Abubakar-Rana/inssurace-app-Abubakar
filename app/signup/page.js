"use client";

// Public "Request access" page — where the marketing page's Get started button
// leads. It is an ENQUIRY, not a sign-up: nobody can create their own CertFlow
// account. Nestnic reads the request, and creates the agency if they approve.

import { useState } from "react";
import Link from "next/link";
import { landingFonts } from "@/components/landing/fonts";
import { Nav } from "@/components/landing/Nav";
import { Footer } from "@/components/landing/Faq";

const FIELDS = [
  { name: "agencyName", label: "Agency name", type: "text", required: true, placeholder: "Whittington Agency, LLC" },
  { name: "contactName", label: "Your name", type: "text", required: true, placeholder: "Alex Whittington" },
  { name: "email", label: "Work email", type: "email", required: true, placeholder: "alex@whittingtonagency.com" },
  { name: "phone", label: "Phone (optional)", type: "tel", required: false, placeholder: "" },
];

export default function SignupPage() {
  const [form, setForm] = useState({ agencyName: "", contactName: "", email: "", phone: "", message: "", website: "" });
  const [state, setState] = useState({ busy: false, done: false, error: null });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setState({ busy: true, done: false, error: null });
    try {
      const res = await fetch("/api/access-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not send your request.");
      setState({ busy: false, done: true, error: null });
    } catch (err) {
      setState({ busy: false, done: false, error: err.message });
    }
  }

  return (
    <div className={`${landingFonts} landing font-body`}>
      <Nav />
      <main className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
        <h1 className="text-balance font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
          Request access to CertFlow
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-600">
          CertFlow accounts are set up for each agency by our team, so your inbox and your policy data stay separated from
          every other agency from the first day. Tell us about your agency and we will be in touch to get you started.
        </p>

        {state.done ? (
          <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
            <h2 className="font-display text-lg font-semibold text-emerald-800">Thank you — we have your request</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-emerald-900">
              Our team will review it and email {form.email} to arrange your setup. Nothing has been created yet, and no
              access has been granted.
            </p>
            <Link href="/" className="mt-4 inline-block text-[14px] font-semibold text-brand-600 hover:underline">
              Back to the home page
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-4 rounded-2xl border border-line bg-white p-6 shadow-card">
            {state.error && <p className="rounded-lg bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">{state.error}</p>}

            {FIELDS.map((f) => (
              <label key={f.name} className="block">
                <span className="mb-1 block text-[13px] font-medium text-ink-800">{f.label}</span>
                <input
                  type={f.type}
                  required={f.required}
                  placeholder={f.placeholder}
                  value={form[f.name]}
                  onChange={set(f.name)}
                  autoComplete={f.name === "email" ? "email" : "off"}
                  className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-[14px] text-ink-900 outline-none transition placeholder:text-ink-300 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15"
                />
              </label>
            ))}

            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-ink-800">
                Anything we should know? (optional)
              </span>
              <textarea
                rows={4}
                value={form.message}
                onChange={set("message")}
                placeholder="How many certificates do you issue a week? Which system holds your policy data?"
                className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-[14px] text-ink-900 outline-none transition placeholder:text-ink-300 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15"
              />
            </label>

            {/* Honeypot: shown to nothing but bots, and never submitted by a person. */}
            <div className="hidden" aria-hidden="true">
              <label>
                Website
                <input type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
              </label>
            </div>

            <button
              type="submit"
              disabled={state.busy}
              className="inline-flex items-center justify-center rounded-lg bg-brand-500 px-5 py-2.5 text-[14px] font-semibold text-white transition hover:bg-brand-600 active:scale-[0.99] disabled:opacity-50"
            >
              {state.busy ? "Sending…" : "Request access"}
            </button>

            <p className="text-[12.5px] leading-snug text-ink-500">
              We use these details only to contact you about CertFlow. Already have an account?{" "}
              <Link href="/signin" className="font-medium text-brand-600 hover:underline">
                Sign in
              </Link>
              .
            </p>
          </form>
        )}
      </main>
      <Footer />
    </div>
  );
}
