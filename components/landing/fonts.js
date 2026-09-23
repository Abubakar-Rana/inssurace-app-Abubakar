// Fonts for the public marketing pages only. The dashboard keeps the system
// stack; these are applied by the /welcome and /signup layouts as CSS variables
// read by the `font-display`, `font-body` and `font-code` Tailwind families.
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";

const display = Inter_Tight({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
  // Small labels only, never above-the-fold text that counts for LCP. Not
  // preloading it keeps it from competing with the two fonts that do.
  preload: false,
});

export const landingFonts = `${display.variable} ${body.variable} ${mono.variable}`;
