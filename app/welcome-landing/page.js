"use client";

// Public marketing page. Deliberately outside AppShell and outside the
// middleware matcher; lib/store.js skips its API calls on this path.

import { Faq, FinalCta, Footer } from "@/components/landing/Faq";
import { Nav } from "@/components/landing/Nav";
import { Features, Hero, HowItWorks, Security, TrustAI } from "@/components/landing/Sections";

export default function WelcomePage() {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-[60] rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <HowItWorks />
        <Features />
        <TrustAI />
        <Security />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
