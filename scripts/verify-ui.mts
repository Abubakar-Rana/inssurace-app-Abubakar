/**
 * Drives the dashboard in a real browser, the way a reviewer would.
 *
 * The API tests prove the server is right; this proves the screen is. It clicks
 * through sign-in -> inbox -> generate -> edit -> approve, and fails on ANY
 * console error, page exception, or failed request along the way — the class of
 * bug that a 200 response will happily hide.
 *
 * Requires the dev server on :3111 and Chrome or Edge installed.
 *
 *   npm run verify:ui
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

const BASE = process.env.UI_BASE ?? "http://localhost:3111";
const SHOTS = join(process.cwd(), "out", "ui");

const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

let failures = 0;
const problems: string[] = [];

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

/** Anything the browser complains about is a failure, not noise. */
function watch(page: Page) {
  page.on("console", (m) => {
    // "Failed to load resource" is the browser echoing an HTTP status the
    // response handler below already judges; keeping both double-counts and
    // flags the expected signed-out 401 on /api/auth/session.
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) {
      problems.push(`console: ${m.text()}`);
    }
  });
  page.on("pageerror", (e) => problems.push(`exception: ${e.message}`));
  page.on("requestfailed", (r) => {
    const url = r.url();
    // Next cancels in-flight RSC prefetches on navigation; that is normal.
    if (url.includes("_rsc=")) return;
    // The live feed is a stream held open for the life of the page. Navigating
    // away aborts it, which the browser reports as a failed request.
    if (url.includes("/api/events")) return;
    if (url.startsWith(BASE)) problems.push(`request failed: ${url} ${r.failure()?.errorText}`);
  });
  page.on("response", (r) => {
    if (r.url().startsWith(BASE) && r.status() >= 400) {
      // 401s before sign-in are expected; the flow asserts on them separately.
      if (!r.url().endsWith("/api/auth/session")) {
        problems.push(`HTTP ${r.status()} ${r.url()}`);
      }
    }
  });
}

/** Screenshots are evidence, not assertions — never fail the run over one. */
async function shot(page: Page, name: string): Promise<void> {
  try {
    await page.waitForFunction(() => document.body.scrollHeight > 0, { timeout: 5000 });
    await page.screenshot({ path: join(SHOTS, `${name}.png`) as `${string}.png`, fullPage: true });
  } catch (err) {
    console.log(`      (screenshot ${name} skipped: ${(err as Error).message.split("\n")[0]})`);
  }
}

/**
 * Click by visible text, inside the page.
 *
 * Element handles go stale whenever React re-renders between the query and the
 * click — which the Suspense boundary on /signin does reliably. Resolving the
 * element and clicking it in one in-page step removes that race.
 */
async function clickText(page: Page, text: string, timeout = 15000): Promise<boolean> {
  try {
    await page.waitForFunction(
      (t: string) =>
        [...document.querySelectorAll("button,a")].some((b) => b.textContent?.includes(t)),
      { timeout },
      text
    );
  } catch {
    return false; // the button is gone, which is often success
  }
  return page.evaluate((t: string) => {
    const el = [...document.querySelectorAll("button,a")].find((b) => b.textContent?.includes(t));
    if (!el) return false;
    (el as HTMLElement).click();
    return true;
  }, text);
}

/**
 * Click, and keep clicking until the page actually reacts.
 *
 * A click that lands before React has hydrated hits an element with no handler
 * attached and is silently swallowed — which in dev, with on-demand
 * compilation, is most of them. Retrying until `settled()` is true is what
 * makes this test about the application rather than about hydration timing.
 */
async function clickUntil(
  page: Page,
  text: string,
  settled: () => Promise<boolean>,
  attempts = 20
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    // Check first: a navigation may already have removed the button, and
    // waiting for it again would just burn the timeout.
    if (await settled().catch(() => false)) return true;
    await clickText(page, text, 2000);
    for (let waited = 0; waited < 1500; waited += 100) {
      await new Promise((r) => setTimeout(r, 100));
      if (await settled().catch(() => false)) return true;
    }
  }
  return settled().catch(() => false);
}

/**
 * Exact match by default. `startsWith` is opt-in because "/" is a prefix of
 * every path — using it loosely made a navigation assertion pass without the
 * click ever happening.
 */
const atPath = (page: Page, path: string, prefix = false) => async () => {
  const actual = new URL(page.url()).pathname;
  return prefix ? actual.startsWith(path) : actual === path;
};

/**
 * Case-insensitive on purpose: `innerText` applies CSS `text-transform`, so a
 * label styled `uppercase` reads back as "WHY THIS NEEDS YOU" however it is
 * written in the JSX. Matching case here asserted on styling, not content.
 */
const bodyHas = (page: Page, text: string) => async () =>
  page.evaluate(
    (t: string) => document.body.innerText.toLowerCase().includes(t.toLowerCase()),
    text
  );

/** Focus an input by its current value and replace the contents. */
async function retype(page: Page, currentValue: string, next: string): Promise<boolean> {
  const focused = await page.evaluate((v: string) => {
    const el = [...document.querySelectorAll("input")].find(
      (i) => (i as HTMLInputElement).value === v
    ) as HTMLInputElement | undefined;
    if (!el) return false;
    el.focus();
    el.select();
    return true;
  }, currentValue);
  if (!focused) return false;
  await page.keyboard.type(next);
  return true;
}

async function main() {
  const executablePath = BROWSERS.find((p) => existsSync(p));
  if (!executablePath) throw new Error("No Chrome or Edge found.");
  mkdirSync(SHOTS, { recursive: true });

  const browser: Browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 1100 });
  watch(page);

  // ---- keep the mailbox out of this test ----
  //
  // The dashboard now checks Gmail on a timer, which would make this suite
  // depend on a live IMAP connection and, worse, on what happens to be sitting
  // in a real inbox while it runs. The polls are answered here with a fixed
  // "nothing new" instead, and counted — so the auto-check is still asserted,
  // just not against Google.
  let autoPolls = 0;
  let liveFeeds = 0;
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (req.url().includes("/api/events")) {
      liveFeeds++;
      void req.continue();
      return;
    }
    if (req.method() === "POST" && req.url().includes("/api/gmail/poll")) {
      autoPolls++;
      void req.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            fetched: 0, candidates: 0, skipped: 0, inserted: 0, duplicates: 0,
            matched: 0, needsMatch: 0, generated: 0, requests: [], ignored: [],
            throttled: false,
          },
        }),
      });
      return;
    }
    void req.continue();
  });

  try {
    // ---- gated when signed out ----
    // The dashboard lives at /inbox; "/" is the public marketing page.
    await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });
    check("signed out -> /signin", new URL(page.url()).pathname === "/signin", page.url());
    // Past the Suspense fallback before anything looks at the DOM.
    await page.waitForFunction(() => document.body.innerText.includes("CertFlow"), {
      timeout: 20000,
    });
    await shot(page, "1-signin");

    // ---- sign in ----
    // The page now also has an email + password form whose button is "Sign in";
    // this test uses the development sign-in, so it names that button exactly.
    const signedIn = await clickUntil(page, "Sign in (development)", async () => {
      const p = new URL(page.url()).pathname;
      return p === "/inbox" || (await bodyHas(page, "Certificate Requests")());
    });
    check("signed in -> inbox", signedIn, page.url());
    await page.waitForSelector("h1", { timeout: 15000 });

    // ---- the inbox shows real data ----
    await page.waitForFunction(
      () => document.body.innerText.includes("Smart Way Solutions"),
      { timeout: 15000 }
    );
    const inboxText = await page.evaluate(() => document.body.innerText);
    check("insured name rendered", inboxText.includes("Smart Way Solutions Inc"));
    check("client number rendered", inboxText.includes("SWS-1001"));
    // The row shows the sender's NAME; at volume the raw address is noise.
    // It stays findable through search, which is what this asserts —
    // `.example` is IANA-reserved, so seeded senders use it and a click on
    // demo data can never email a real company. See lib/gmail/send.ts.
    const searchable = await page.evaluate(async () => {
      const box = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement | null;
      if (!box) return "no search box";
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      setter?.call(box, "datsolutions.example");
      box.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      const hit = document.body.innerText.includes("Smart Way Solutions");
      setter?.call(box, "");
      box.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      return hit ? "ok" : "no match for the sender address";
    });
    check("requester findable by address", searchable === "ok", searchable);
    check("signed-in user in header", inboxText.includes("Certificate Department"));
    await shot(page, "2-inbox");

    // ---- unmatched requests offer a way forward, not a dead end ----
    check("unmatched requests offer 'Identify insured'", await bodyHas(page, "Identify insured")());

    // The dialog's header renders immediately but its evidence arrives from the
    // API — wait for the loaded state, not just the shell.
    check(
      "match dialog opens",
      await clickUntil(page, "Identify insured", bodyHas(page, "Why this needs you"))
    );
    const matchText = (await page.evaluate(() => document.body.innerText)).toLowerCase();
    check("explains why it needs a human", matchText.includes("why this needs you"));
    check("offers an insured to search", matchText.includes("search the insured list"));
    check("lists a real insured to pick", matchText.includes("smart way solutions inc"));
    await shot(page, "2b-match-dialog");
    check("match dialog closes", await clickUntil(page, "Cancel", async () => !(await bodyHas(page, "Search the insured list")())));

    // ---- the certificates page exists and is reachable ----
    check("certificates link navigates", await clickUntil(page, "Certificates", atPath(page, "/certificates")));
    await page.waitForFunction(() => document.body.innerText.includes("Issued Certificates"), {
      timeout: 20000,
    });
    check("certificates page renders", await bodyHas(page, "Issued Certificates")());
    await shot(page, "2c-certificates");

    check(
      "back to the inbox",
      await clickUntil(page, "Inbox", bodyHas(page, "Needs you"))
    );

    // ---- no dead nav links ----
    const deadNav = await page.$$eval("a", (as) =>
      as
        .filter((a) => ["Distributions", "AMS Sync"].some((t) => a.textContent?.includes(t)))
        .map((a) => a.textContent?.trim())
    );
    check("prototype nav links removed", deadNav.length === 0, deadNav.join(", "));

    // ---- the dashboard receives updates without being asked ----
    //
    // Nobody has clicked anything. The dashboard should have opened a live feed
    // on its own; if it has not, requests only appear when a reviewer thinks to
    // go looking, which is exactly what this design removes.
    const deadline = Date.now() + 8000;
    while (liveFeeds === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }
    check("opens a live feed unprompted", liveFeeds > 0, `${liveFeeds} connection(s)`);

    const header = await page.evaluate(() => document.body.innerText);
    // The feed state is stated in words in the sidebar, not as a coloured dot.
    check("shows the feed is connected", /Watching mailbox|Connecting|Reconnecting/.test(header));
    check("shows an unread count", /\d+ unread/.test(header), header.slice(0, 60));
    // The three questions the queue exists to answer, carried as counts so
    // they survive any volume.
    check(
      "tabs carry the counts",
      /Needs you/.test(header) && /Waiting on requester/.test(header) && /Done/.test(header)
    );
    check("no 'Check now' button to press", !(await page.$$eval("button", (bs) =>
      bs.map((b) => (b.textContent ?? "").trim()))).some((t) => /check now/i.test(t)));
    check("no 'Refresh' button to press", !(await page.$$eval("button", (bs) =>
      bs.map((b) => (b.textContent ?? "").trim()))).some((t) => t === "Refresh"));

    // ---- drafts exist before anyone asks ----
    //
    // Certificates are assembled during ingestion, so the inbox offers review,
    // not generation. The absence of the old button is asserted directly: if it
    // came back, drafting would silently be a manual step again.
    const buttons = await page.$$eval("button", (bs) => bs.map((b) => b.textContent ?? ""));
    check(
      "no 'Generate certificate' button anywhere",
      !buttons.some((t) => /generate certificate/i.test(t)),
      buttons.filter((t) => /generate/i.test(t)).join(", ")
    );
    // THIS SUITE CONSUMES A DRAFT. It approves one every run, and an issued
    // certificate is never editable again, so a seeded database supports a
    // limited number of runs before there is nothing left to review. Without
    // this message the next run fails as a thirty-second timeout on a click,
    // which says nothing about the actual cause.
    const reviewable = buttons.some((t) => /review certificate/i.test(t));
    check(
      "matched requests offer review",
      reviewable,
      reviewable ? "" : "no draft left to review — run `npm run db:seed` first"
    );
    if (!reviewable) {
      console.log("\nSKIPPED the certificate flow: no reviewable draft in the database.");
      console.log("Run `npm run db:seed`, restart `npm run watch`, then try again.\n");
      await browser.close();
      report();
      return;
    }

    check(
      "review -> certificate page",
      await clickUntil(page, "Review certificate", atPath(page, "/certificate/", true), 12)
    );
    await page.waitForFunction(() => document.body.innerText.includes("ACORD"), { timeout: 30000 });

    // ---- both sheets rendered ----
    const sheets = await page.$$eval("div", (ds) =>
      ds.filter((d) => (d as HTMLElement).style.backgroundImage.includes("acord")).length
    );
    // One sheet or two, depending on which insured this request resolved to.
    // The seed now carries two companies with different fleet sizes, and only a
    // fleet that overflows page one produces an ACORD 101 — so requiring two
    // sheets would assert which company happened to be topmost, not that
    // overflow works. `npm run verify` proves the split against the real sample.
    check("the ACORD form is rendered", sheets >= 1, `${sheets} sheet(s)`);

    const certText = await page.evaluate(() => document.body.innerText);
    check("certificate number shown", /COI-\d{4}-\d{4}/.test(certText), certText.match(/COI-\d{4}-\d{4}/)?.[0]);
    check("shows draft state", certText.includes("Draft"));
    await shot(page, "3-certificate-draft");

    // ---- the form carries database values ----
    const fieldValues = await page.$$eval("input", (els) =>
      els.map((e) => (e as HTMLInputElement).value).filter(Boolean)
    );
    check("producer filled", fieldValues.includes("Whittington Agency, LLC"));
    // Either seeded insured is a correct answer — which one appears depends on
    // what the resolver matched, and pinning it here would make this suite fail
    // for a reason that has nothing to do with the form being filled.
    check(
      "insured filled from the database",
      fieldValues.some((v) => /^Smart Way Solutions (Inc|LLC)$/.test(v)),
      fieldValues.find((v) => v.startsWith("Smart Way")) ?? "none"
    );
    check(
      "policy number filled",
      fieldValues.some((v) => /^20267\d{5}$|^2026256248$/.test(v)),
      fieldValues.find((v) => /^2026\d{6}$/.test(v)) ?? "none"
    );
    // The holder is the REQUESTER, read from their signature — so it must be
    // one of the companies that actually wrote in, and must NOT be the postal
    // address that used to be printed on every certificate from a stored row.
    //
    // The holder box is a name input plus a multi-line address, so this reads
    // textareas too — the company usually lands in the address half.
    const blockValues = await page.$$eval(
      '[data-field^="holder."]',
      (els) => els.map((e) => (e as HTMLInputElement | HTMLTextAreaElement).value).filter(Boolean)
    );
    // Asserted structurally rather than against an expected company.
    //
    // Which request is topmost depends on what has been approved already and on
    // what real mail the auto-check has ingested, so naming a company here makes
    // the suite fail for a reason that has nothing to do with the holder. The
    // exact extraction is proven per-email and deterministically by
    // `npm run verify:holder`; what this suite has to show is that whatever was
    // read reaches the printed form — and that the old stored postal address,
    // which used to appear on every certificate regardless of who asked, does
    // not.
    check(
      "holder block is filled",
      blockValues.length > 0 && blockValues[0].trim().length > 0,
      blockValues.join(" / ")
    );
    check(
      "holder is not the stored postal address",
      !blockValues.some((v) => v.includes("10260 SW Greenburg Rd"))
    );
    check(
      "holder is neither the insured nor the agency",
      !blockValues.some((v) => v.includes("Smart Way Solutions") || v.includes("Whittington")),
      blockValues.join(" / ")
    );
    // The free rows carry whatever non-standard coverages the insured holds.
    // Both seeded companies have Motor Truck Cargo; only one also has Physical
    // Damage, so requiring both would again assert which company was picked.
    check(
      "free coverage rows filled",
      fieldValues.includes("Motor Truck Cargo"),
      fieldValues.filter((v) => /Cargo|Physical Damage/.test(v)).join(", ") || "none"
    );

    // ---- edit, and confirm it persists ----
    const before = problems.length;
    check("edit mode opens", await clickUntil(page, "Edit form", bodyHas(page, "Edit mode")));

    // Whatever the signature produced — the point is that the reviewer can
    // correct it, not what it happens to say.
    const holderName = await page.$eval(
      '[data-field="holder.name"]',
      (el) => (el as HTMLInputElement).value
    );
    check(
      "holder field is editable",
      Boolean(holderName) && (await retype(page, holderName, `${holderName} (Attn: AP)`)),
      holderName
    );

    await page.waitForFunction(() => document.body.innerText.includes("Saved"), { timeout: 10000 });
    check("edit saved to the server", true);
    check("no errors while editing", problems.length === before);
    await shot(page, "4-editing");

    // survives a reload => it really persisted
    await page.reload({ waitUntil: "domcontentloaded" });
    // Wait for the value itself rather than sampling once after the page text
    // appears — the form fields populate a beat after the toolbar does.
    const edited = `${holderName} (Attn: AP)`;
    let survived = false;
    try {
      await page.waitForFunction(
        (want: string) =>
          [...document.querySelectorAll("input")].some(
            (i) => (i as HTMLInputElement).value === want
          ),
        { timeout: 30000 },
        edited
      );
      survived = true;
    } catch {
      survived = false;
    }
    const holderValues = await page.$$eval("input", (els) =>
      els.map((e) => (e as HTMLInputElement).value).filter((v) => v.includes("Attn"))
    );
    check("edit survived a reload", survived, survived ? "" : `found: ${JSON.stringify(holderValues)}`);

    // ---- approve ----
    check(
      "approve -> issued",
      await clickUntil(page, "Approve & issue", bodyHas(page, "Nothing has been emailed"))
    );
    const issuedText = await page.evaluate(() => document.body.innerText);
    check("approved -> Issued", issuedText.includes("Issued"));
    check("says nothing was emailed", issuedText.includes("Nothing has been emailed"));

    const editDisabled = await page.$$eval("button", (bs) => {
      const b = bs.find((x) => x.textContent?.includes("Edit form"));
      return (b as HTMLButtonElement)?.disabled ?? false;
    });
    check("editing disabled once issued", editDisabled);
    await shot(page, "5-issued");

    // ---- the PDF endpoint serves a real document ----
    const pdf = await page.evaluate(async () => {
      const href = (document.querySelector('a[href*="/pdf"]') as HTMLAnchorElement)?.href;
      if (!href) return null;
      const r = await fetch(href);
      const b = await r.arrayBuffer();
      return { status: r.status, type: r.headers.get("content-type"), bytes: b.byteLength };
    });
    check("PDF link serves a PDF", pdf?.status === 200 && pdf.type === "application/pdf", `${pdf?.bytes} bytes`);

    // ---- sign out ----
    let signedOut = false;
    for (let i = 0; i < 20 && !signedOut; i++) {
      // The click navigates, which tears down the execution context this call
      // is running in — an expected outcome here, not an error.
      await page
        .evaluate(() => {
          const b = [...document.querySelectorAll("button")].find(
            (x) => x.getAttribute("title") === "Sign out"
          );
          (b as HTMLButtonElement)?.click();
        })
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 400));
      signedOut = new URL(page.url()).pathname === "/signin";
    }
    check("sign out -> /signin", signedOut, page.url());
  } catch (err) {
    // Dump what the browser saw — a bare timeout says nothing useful.
    failures++;
    console.log(`\nFAILED: ${(err as Error).message.split("\n")[0]}`);
    console.log(`  url:  ${page.url()}`);
    const body = await page.evaluate(() => document.body.innerText).catch(() => "(unreadable)");
    console.log(`  page: ${body.replace(/\n+/g, " | ").slice(0, 400)}`);
    await shot(page, "failure");
  } finally {
    await browser.close();
  }

  report();
}

/** Summarise and exit. Extracted so an early return still reports. */
function report(): never {
  if (problems.length) {
    failures += problems.length;
    console.log(`\n${problems.length} browser problem(s):`);
    for (const p of [...new Set(problems)]) console.log(`   ${p}`);
  }

  console.log(`\nscreenshots: out/ui/`);
  console.log(failures === 0 ? "all UI checks passed" : `${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
