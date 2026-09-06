/**
 * Proof that a real email reaches the dashboard on its own.
 *
 * SENDS REAL MAIL — the mailbox to itself — then opens the dashboard in Chrome
 * and touches nothing. If the request appears, the whole chain works unattended:
 * detection, classification, interpretation, drafting, and the browser noticing.
 *
 * It reports TWO numbers, because only one of them is ours:
 *
 *   DELIVERY   send -> the message becoming visible over IMAP. This is Gmail's
 *              own latency and nothing in this system can affect it.
 *   DETECTION  visible in the mailbox -> visible on the dashboard. This is the
 *              part the watcher, the ingest path and the live feed are
 *              responsible for, and the only part worth holding to a target.
 *
 * Reporting only the total would credit or blame us for Gmail's delivery time.
 *
 * Needs the dev server running; set UI_BASE if it is not on :3111.
 *
 *   npx next dev -p 3111 &
 *   npm run verify:autopoll
 */

import "@/lib/env";
import { existsSync } from "node:fs";
import { ImapFlow } from "imapflow";
import puppeteer from "puppeteer-core";
import { gmailConfigFromEnv } from "@/lib/gmail/inbox";
import { sendReply } from "@/lib/gmail/send";

const BASE = process.env.UI_BASE ?? "http://localhost:3111";
const MARK = `Live-check ${Date.now().toString().slice(-6)}`;

/**
 * What the detection half is held to.
 *
 * The mailbox is checked every few seconds and ingesting costs a handful of
 * database round trips, so a few seconds is expected. The FIRST request after a
 * server restart is slower — the dev server compiles routes on demand and the
 * watcher runs a catch-up sweep — which is a development artefact, not
 * something a running deployment does.
 *
 * Observed range against a remote database in development: roughly one to seven
 * seconds, median about five. The floor is set by the database round trips
 * needed to store and interpret a request, not by how often the mailbox is
 * checked. The target here is a REGRESSION GUARD, deliberately looser than the
 * typical figure so a normally-slow run does not fail the build.
 */
const DETECTION_TARGET_SECONDS = Number(process.env.DETECTION_TARGET_SECONDS ?? 10);

const exe = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((x) => existsSync(x))!;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * SENDS REAL MAIL — opt in with SEND_REAL_MAIL=1.
 *
 * Guarded because these tests are cheap to run and expensive to have run: each
 * one leaves a permanent message in a real mailbox, and repeated runs during
 * development filled one to capacity. A test that quietly consumes somebody's
 * storage should have to be asked for.
 */
function requireOptIn(name: string): void {
  if (process.env.SEND_REAL_MAIL === "1") return;
  console.log(`\n${name} sends real email and is opt-in.`);
  console.log("Set SEND_REAL_MAIL=1 to run it:\n");
  console.log(`  SEND_REAL_MAIL=1 npm run ${name}\n`);
  process.exit(0);
}

async function main() {
  requireOptIn("verify:autopoll");

  const config = gmailConfigFromEnv();

  // A separate connection, purely to observe when Gmail makes the message
  // visible. It never ingests anything; the running server does that.
  const watcher = new ImapFlow({
    host: config.host!,
    port: config.port!,
    secure: true,
    auth: { user: config.user, pass: config.appPassword },
    logger: false,
  });
  await watcher.connect();
  await watcher.mailboxOpen(config.mailbox ?? "INBOX", { readOnly: true });
  const before = await watcher.search({ all: true }, { uid: true });
  const highWater = Array.isArray(before) && before.length ? Math.max(...before) : 0;

  console.log(`sending a COI request to ${config.user} …`);
  await sendReply({
    to: config.user,
    subject: `COI request - ${MARK}`,
    text: [
      "Hi,",
      "",
      "Please send a certificate of insurance for Smartway Solutions.",
      "",
      "Regards,",
      "Priya Nair",
      "Carrier Compliance",
      "Cascade Freight Partners Inc",
    ].join("\n"),
  });
  const sentAt = Date.now();
  console.log(`  sent. subject marker: ${MARK}`);

  // Watch for arrival in the background while the browser starts up, so the
  // two measurements do not serialise.
  let visibleAt = 0;
  const arrival = (async () => {
    while (Date.now() - sentAt < 120_000) {
      await sleep(500);
      await watcher.noop();
      const found = await watcher.search({ uid: `${highWater + 1}:*` }, { uid: true });
      const fresh = (Array.isArray(found) ? found : []).filter((u) => u > highWater);
      if (fresh.length) {
        visibleAt = Date.now();
        return;
      }
    }
  })();

  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });

  let feeds = 0;
  page.on("response", (r) => {
    if (r.url().includes("/api/events")) feeds++;
  });

  await page.goto(`${BASE}/signin`, { waitUntil: "domcontentloaded" });
  await sleep(1200);
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /sign in/i.test(x.textContent ?? ""));
    if (b) (b as HTMLButtonElement).click();
    return Boolean(b);
  });
  if (!clicked) throw new Error("no sign-in button");
  await sleep(4000);

  console.log("dashboard open. NOT clicking anything — waiting for the request to appear …");
  const deadline = Date.now() + 150_000;
  let found = false;
  while (Date.now() < deadline) {
    const text = await page.evaluate(() => document.body.innerText);
    if (text.includes(MARK)) {
      found = true;
      break;
    }
    await sleep(500);
  }
  const shownAt = Date.now();

  await arrival;
  await watcher.logout().catch(() => watcher.close());
  await page.screenshot({ path: "out/ui/live-autopoll.png" });
  await browser.close();

  if (!found) {
    console.log(`\nFAIL  never appeared (${feeds} live feed connection(s))`);
    process.exit(1);
  }

  const delivery = visibleAt ? (visibleAt - sentAt) / 1000 : NaN;
  // Can come out slightly negative: the observer connection above polls every
  // 500ms with its own NOOP, so the running server sometimes sees the message
  // first. That means detection beat the instrument, not that it took less
  // than no time — report it as such rather than printing a negative number.
  const raw = visibleAt ? (shownAt - visibleAt) / 1000 : NaN;
  const detection = Math.max(0, raw);

  console.log("");
  console.log(`  Gmail delivery   ${delivery.toFixed(1)}s   (send -> visible over IMAP; not ours)`);
  console.log(`  DETECTION        ${raw < 0 ? "<0.5" : detection.toFixed(1)}s   (in the mailbox -> on the dashboard)`);
  console.log(`  total            ${((shownAt - sentAt) / 1000).toFixed(1)}s`);
  console.log("");

  const ok = !Number.isNaN(detection) && detection <= DETECTION_TARGET_SECONDS;
  console.log(
    ok
      ? `PASS  appeared unprompted, ${detection.toFixed(1)}s after landing in the mailbox (0 clicks)`
      : `FAIL  detection took ${detection.toFixed(1)}s, over the ${DETECTION_TARGET_SECONDS}s target`
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
