/**
 * Photographs the dashboard so a change can be LOOKED AT rather than assumed.
 *
 * The same instinct as scripts/pdf-to-png.mts: a rendering change is not done
 * until someone has seen it. Signs in the way scripts/verify-ui.mts does, then
 * captures each screen at desktop width.
 *
 *   npx next dev -p 3111 &
 *   npx tsx scripts/shoot-ui.mts            # -> out/ui-shots/*.png
 *   UI_BASE=http://localhost:3000 npx tsx scripts/shoot-ui.mts
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import puppeteer, { type Page } from "puppeteer-core";

const BASE = process.env.UI_BASE ?? "http://localhost:3111";
const OUT = "out/ui-shots";
const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

async function shot(page: Page, name: string) {
  await new Promise((r) => setTimeout(r, 350));
  await page.screenshot({ path: join(OUT, `${name}.png`) as `${string}.png` });
  console.log(`  ${OUT}/${name}.png`);
}

/** Clicks the first element whose text matches, without relying on a selector. */
async function clickText(page: Page, text: string): Promise<boolean> {
  return page.evaluate((t) => {
    const els = [...document.querySelectorAll("button, a, [role=button]")];
    const hit = els.find((e) => (e.textContent || "").trim().toLowerCase().includes(t.toLowerCase()));
    if (!hit) return false;
    (hit as HTMLElement).click();
    return true;
  }, text);
}

async function main() {
  const executablePath = BROWSERS.find((p) => existsSync(p));
  if (!executablePath) throw new Error("No Chrome or Edge found.");
  mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

  try {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("CertFlow"), { timeout: 20000 });

    if (new URL(page.url()).pathname === "/signin") {
      await shot(page, "0-signin");
      // Click ONCE. Sign-in is a round trip; clicking again mid-flight
      // restarts it, which is how this first ran and photographed a button
      // that said "Signing in…" forever.
      await clickText(page, "Sign in");
      for (let i = 0; i < 60; i++) {
        if (new URL(page.url()).pathname === "/") break;
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    await page.waitForFunction(() => document.body.innerText.includes("Inbox"), { timeout: 20000 });
    await page.waitForFunction(() => !document.body.innerText.includes("Loading requests"), {
      timeout: 15000,
    }).catch(() => {});

    await shot(page, "1-inbox-needs");

    for (const [tab, name] of [
      ["Waiting on requester", "2-inbox-waiting"],
      ["Done", "3-inbox-done"],
      ["All", "4-inbox-all"],
    ] as [string, string][]) {
      if (await clickText(page, tab)) await shot(page, name);
    }

    // Back to the working tab, then into a certificate if one is drafted.
    await clickText(page, "Needs you");
    await new Promise((r) => setTimeout(r, 300));
    // A draft says "Review certificate"; once issued the same row says "View".
    if ((await clickText(page, "Review certificate")) || (await clickText(page, "View certificate"))) {
      // Assembling a certificate that does not exist yet is a round trip to
      // the database; wait for the form itself rather than a guessed delay.
      await page
        .waitForFunction(() => !document.body.innerText.includes("Assembling certificate"), {
          timeout: 30000,
        })
        .catch(() => console.log("  (still assembling after 30s)"));
      await page
        .waitForFunction(
          () =>
            [...document.querySelectorAll("div")].some((d) =>
              getComputedStyle(d).backgroundImage.includes("acord")
            ),
          { timeout: 20000 }
        )
        .catch(() => console.log("  (no ACORD sheet rendered)"));
      await new Promise((r) => setTimeout(r, 700));
      await shot(page, "5-certificate");
      // A document page is taller than the window; prove it can actually move.
      const scrolled = await page.evaluate(() => {
        const box = [...document.querySelectorAll("main, div")].find(
          (e) => e.scrollHeight > e.clientHeight + 40 && getComputedStyle(e).overflowY !== "hidden"
        ) as HTMLElement | undefined;
        if (!box) return { ok: false, why: "nothing scrollable" };
        box.scrollTop = box.scrollHeight;
        return { ok: box.scrollTop > 40, why: `scrollTop ${Math.round(box.scrollTop)}` };
      });
      console.log(`  certificate page scrolls: ${scrolled.ok ? "yes" : "NO"} (${scrolled.why})`);

      // Horizontal fit is measured, not eyeballed: the form is sized by a
      // ResizeObserver, and the only way to know it agrees with the column it
      // sits in is to ask the layout.
      console.log(
        await page.evaluate(() => {
          const out: string[] = [];
          const main = document.querySelector("main");
          if (main) out.push(`  main  client=${main.clientWidth} scroll=${main.scrollWidth}`);
          const grid = [...document.querySelectorAll("div")].find(
            (d) =>
              getComputedStyle(d).display === "grid" &&
              getComputedStyle(d).gridTemplateColumns.split(" ").length > 1
          );
          if (grid)
            out.push(`  grid  cols=[${getComputedStyle(grid).gridTemplateColumns}] client=${grid.clientWidth}`);
          const wrap = [...document.querySelectorAll("div")].find(
            (d) => getComputedStyle(d).overflowX === "auto"
          );
          if (wrap) out.push(`  wrap  client=${wrap.clientWidth} scroll=${wrap.scrollWidth}`);
          const sized = [...document.querySelectorAll("div[style*='width']")].find((d) =>
            /^\d+px$/.test((d as HTMLElement).style.width)
          ) as HTMLElement | undefined;
          if (sized) out.push(`  formW ${sized.style.width}`);
          return out.join("\n");
        })
      );

      await shot(page, "6-certificate-bottom");
    }

    await page.goto(`${BASE}/certificates`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("Certificate"), { timeout: 15000 });
    await shot(page, "7-certificates");
  } finally {
    if (problems.length) {
      console.log("\nconsole errors:");
      for (const p of [...new Set(problems)].slice(0, 10)) console.log(`  ${p}`);
    } else {
      console.log("\nno console errors");
    }
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
