"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { Icon } from "./icons";
import MatchModal from "./MatchModal";

// The API returns ISO strings. These parse them by hand rather than with Date,
// so the server and the client render the same characters and hydration cannot
// mismatch — see the dates/money convention in CLAUDE.md.
function formatTime(iso) {
  const t = (iso || "").split("T")[1] || "";
  const [hStr, m] = t.split(":");
  let h = parseInt(hStr || "0", 10);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

function dayKey(iso) {
  return (iso || "").split("T")[0];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDay(iso) {
  const [y, m, d] = dayKey(iso).split("-");
  if (!y) return "";
  return `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

/**
 * Which stage of the journey a request is at.
 *
 * This is the whole information architecture, and it follows the work itself:
 * a request ARRIVES, a certificate is PREPARED from it, a person approves it so
 * it is READY, and then it is SENT. Every status maps to exactly one stage, so
 * a request is never in two tabs and never in none.
 */
function bucketOf(status) {
  if (status === "ready") return "prepared"; // drafted, waiting on a reviewer
  if (status === "approved") return "ready"; // issued, not yet emailed
  if (status === "sent" || status === "rejected") return "sent";
  return "arrivals"; // new, interpreting, needsMatch, awaitingRequester
}

/**
 * Within "needs you", what KIND of work it is.
 *
 * Identifying an insured and checking a finished document are different acts,
 * and a reviewer batches them differently, so they get their own headings.
 * "Just arrived" is neither — the system is still reading the email, and
 * showing it as needing identification would be a lie about whose turn it is.
 */
function groupOf(req) {
  if (req.status === "new" || req.status === "interpreting") return "arriving";
  if (req.status === "awaitingRequester") return "waiting";
  if (req.status === "approved") return "approved";
  return req.insuredName ? "review" : "identify";
}

const GROUP_LABEL = {
  arriving: "Just arrived",
  identify: "Needs identifying",
  waiting: "Waiting on the requester",
  review: "Drafted, awaiting your review",
  approved: "Approved — ready to send",
};

/** Why this request is sitting here, in the reviewer's own terms. */
function reasonFor(req) {
  // An agency running on auto-send is not watching the queue, so the one thing
  // that must never be quiet is "this one did not go out".
  if (req.autoSendError) {
    return `Automatic sending stopped · ${req.autoSendError}`;
  }
  if (req.insuredName) {
    return [req.insuredName, req.clientNumber && `#${req.clientNumber}`, req.certificateStatus === "issued" ? "issued" : req.certificateId && "draft"]
      .filter(Boolean)
      .join(" · ");
  }
  if (req.status === "awaitingRequester") return "Asked the requester which company they mean";
  if (req.status === "new" || req.status === "interpreting") return "Reading the email…";
  if (req.matchConfidence === "ambiguous") return "More than one client fits that name";
  if (req.matchConfidence === "clarificationUnclear") return "The reply didn't resolve the company";
  return "No insured identified · the email never named one";
}

const TABS = [
  { id: "arrivals", label: "New requests" },
  { id: "prepared", label: "Prepared" },
  { id: "ready", label: "Ready to send" },
  { id: "sent", label: "Sent" },
  { id: "all", label: "All" },
];

/** Rows per page. Paging is explicit and numbered — never infinite scroll. */
const PAGE_SIZE = 25;

/** The order the headings read in, whichever tab is open. */
const GROUP_ORDER = ["arriving", "identify", "waiting", "review", "approved"];

const EMPTY_COPY = {
  arrivals: ["Nothing new", "New certificate requests will appear here as they arrive."],
  prepared: ["No certificates prepared", "When a request is matched to an insured, its certificate is drafted here."],
  ready: ["Nothing ready to send", "Certificates you approve wait here until they are emailed."],
  sent: ["Nothing sent yet", "Certificates you have emailed to a requester appear here."],
  all: ["Nothing here", "Requests will appear here as they arrive."],
};

export default function InboxView() {
  const store = useStore();
  const router = useRouter();
  const [tab, setTab] = useState("arrivals");
  const [query, setQuery] = useState("");
  const [pageNo, setPageNo] = useState(1);
  const [opening, setOpening] = useState(null);
  const [matching, setMatching] = useState(null);
  const [failed, setFailed] = useState(null);
  const [arrived, setArrived] = useState(null);
  const [ignored, setIgnored] = useState(null);

  // The live feed lives in the store now; this only turns the last arrival
  // into something worth saying.
  const seen = useRef(null);
  useEffect(() => {
    const e = store.lastEvent;
    if (!e || seen.current === e.at) return;
    seen.current = e.at;
    setArrived(`${e.inserted} new request${e.inserted === 1 ? "" : "s"} just arrived.`);
  }, [store.lastEvent]);

  const counts = useMemo(() => {
    const c = { arrivals: 0, prepared: 0, ready: 0, sent: 0, all: store.requests.length };
    store.requests.forEach((r) => {
      c[bucketOf(r.status)] += 1;
    });
    return c;
  }, [store.requests]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return store.requests.filter((r) => {
      if (tab !== "all" && bucketOf(r.status) !== tab) return false;
      if (!q) return true;
      return [r.subject, r.fromName, r.from, r.insuredName, r.clientNumber, r.reference]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [store.requests, tab, query]);

  // Sent work is for finding, not reading: one line a row, grouped by the day
  // it came in. Everything else is grouped by what it asks of you.
  const archive = tab === "sent";

  // Every tab is paged, so the screen behaves the same at 20 requests and at
  // 20,000. The page is clamped rather than reset when the list shrinks under
  // it — a live arrival must never yank the page out from under a reviewer.
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(pageNo, pageCount);
  const from = (current - 1) * PAGE_SIZE;
  const page = visible.slice(from, from + PAGE_SIZE);

  // Grouped by key, not by runs. The list is ordered by arrival time, so the
  // kinds of work interleave — collecting them into buckets is what keeps
  // "Needs identifying" one heading instead of four.
  const sections = useMemo(() => {
    const byKey = new Map();
    for (const req of page) {
      const k = archive ? dayKey(req.receivedAt) : groupOf(req);
      if (!byKey.has(k)) {
        byKey.set(k, { key: k, label: archive ? formatDay(req.receivedAt) : GROUP_LABEL[k], items: [] });
      }
      byKey.get(k).items.push(req);
    }
    // Live work reads in the order a reviewer works it; the archive reads
    // newest first, which is the order it already arrived in.
    if (archive) return [...byKey.values()];
    return GROUP_ORDER.map((k) => byKey.get(k)).filter(Boolean);
  }, [page, archive]);

  // A new search, or a new tab, starts at the first page.
  useEffect(() => {
    setPageNo(1);
  }, [tab, query]);

  const showIgnored = useCallback(async () => {
    if (ignored) return setIgnored(null);
    try {
      setIgnored(await store.recentlyIgnored());
    } catch {
      setIgnored([]);
    }
  }, [ignored, store]);

  // Drafts are assembled the moment a request is ingested, so this normally
  // just navigates. The generate call is a repair path: it runs only when a
  // matched request somehow has no certificate — drafting failed at ingestion,
  // or the request predates automatic drafting.
  async function openCertificate(req) {
    // Opening it is what "checked" means. Not awaited: the reviewer should
    // never wait on bookkeeping.
    if (req.unread) void store.markViewed(req.id);

    if (req.certificateId) {
      router.push(`/certificate/${req.id}`);
      return;
    }
    setOpening(req.id);
    setFailed(null);
    try {
      await store.generateCertificate(req.id);
      router.push(`/certificate/${req.id}`);
    } catch (err) {
      setFailed(err.message);
    } finally {
      setOpening(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* ───────────────── heading ───────────────── */}
      <div className="flex flex-none items-baseline gap-2.5 px-[22px] pt-[18px]">
        <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-ink-900">Inbox</h1>
        <span className="text-[13px] text-ink-400">
          {store.hydrated ? `${counts.all} request${counts.all === 1 ? "" : "s"}` : "…"}
        </span>
      </div>

      {/* ───────────────── tabs ─────────────────
          The counts live here so "what needs me / what's waiting / what's
          done" is answered without scrolling, at any volume. */}
      <div className="mt-3 flex flex-none items-center gap-[22px] border-b border-line px-[22px]">
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex h-9 items-center gap-[7px] transition ${
                on ? "shadow-[inset_0_-2px_0_#f26522]" : "hover:shadow-[inset_0_-2px_0_#ffc7ad]"
              }`}
            >
              <span className={`text-[13px] ${on ? "font-semibold text-ink-900" : "text-ink-500"}`}>
                {t.label}
              </span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11.5px] font-semibold ${
                  on ? "bg-brand-50 text-brand-600" : "bg-ink-900/5 text-ink-500"
                }`}
              >
                {counts[t.id]}
              </span>
            </button>
          );
        })}

        <div className="flex-1" />

        {/* Search sits with the list it filters. Client-side over what is
            already loaded — when the list outgrows one fetch this moves to
            the query, and nothing above it changes. */}
        <div className="flex h-[34px] items-center gap-2 self-center rounded-lg bg-surface-hover px-3 focus-within:bg-white focus-within:ring-[1.5px] focus-within:ring-brand-500">
          <Icon.Inbox width={15} height={15} className="flex-none text-ink-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search requests, insureds, certificates"
            className="w-[240px] bg-transparent text-[13px] text-ink-900 outline-none placeholder:text-ink-400"
          />
          {query && (
            <span className="flex-none text-[11.5px] text-ink-400">{visible.length} match{visible.length === 1 ? "" : "es"}</span>
          )}
        </div>
      </div>

      {/* ───────────────── banners ───────────────── */}
      <div className="flex-none px-[22px]">
        {store.live === "offline" && (
          <div className="mt-3 rounded-lg bg-surface-hover px-3.5 py-2.5 text-[12.5px] text-ink-700">
            Not receiving live updates at the moment. Reconnecting automatically — the list still
            refreshes on its own, just more slowly.
          </div>
        )}
        {store.error && (
          <div className="mt-3 rounded-lg bg-surface-hover px-3.5 py-2.5 text-[12.5px] text-ink-700">
            Could not load requests: {store.error}
          </div>
        )}
        {failed && (
          <div className="mt-3 rounded-lg bg-surface-hover px-3.5 py-2.5 text-[12.5px] text-ink-700">
            Could not prepare the certificate: {failed}
          </div>
        )}
        {arrived && (
          <div className="mt-3 flex items-center gap-3 rounded-lg bg-surface-hover px-3.5 py-2.5 text-[12.5px] text-ink-700">
            <span className="flex-1">{arrived}</span>
            <button onClick={() => setArrived(null)} className="font-semibold text-ink-600 hover:text-ink-900">
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* ───────────────── list ───────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!store.hydrated && <p className="px-[22px] pt-5 text-[13px] text-ink-400">Loading requests…</p>}

        {store.hydrated && visible.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 pb-16">
            <Icon.Inbox width={30} height={30} strokeWidth={1.4} className="text-ink-300" />
            <p className="mt-3 text-[15px] font-semibold text-ink-900">
              {query ? "Nothing matches that" : (EMPTY_COPY[tab] ?? EMPTY_COPY.all)[0]}
            </p>
            <p className="text-[13.5px] text-ink-500">
              {query
                ? "Try a company name, a sender, or a certificate number."
                : (EMPTY_COPY[tab] ?? EMPTY_COPY.all)[1]}
            </p>
            {!query && tab === "arrivals" && (
              <p className="mt-5 text-[12.5px] text-ink-400">
                New requests appear on their own — nothing to refresh.
              </p>
            )}
          </div>
        )}

        {sections.map((section) => (
          <div key={section.key}>
            <div className="sticky top-0 z-[2] flex h-8 items-center gap-2.5 border-b border-line bg-surface-shell px-[22px]">
              <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
                {section.label}
              </span>
              <span className="text-[12px] text-ink-400">{section.items.length}</span>
            </div>

            {section.items.map((req) =>
              archive ? (
                <ArchiveRow key={req.id} req={req} onOpen={() => openCertificate(req)} />
              ) : (
                <LiveRow
                  key={req.id}
                  req={req}
                  busy={opening === req.id}
                  onIdentify={() => {
                    if (req.unread) void store.markViewed(req.id);
                    setMatching(req.id);
                  }}
                  onOpen={() => openCertificate(req)}
                />
              )
            )}
          </div>
        ))}

        {/* Numbered paging, so the screen reads the same at any volume and a
            reviewer always knows where they are in the list. */}
        {pageCount > 1 && (
          <Pager page={current} pageCount={pageCount} total={visible.length} onGo={setPageNo} />
        )}
      </div>

      {/* ───────────────── footer ───────────────── */}
      <div className="flex h-[38px] flex-none items-center gap-3.5 border-t border-line bg-surface-sunken px-[22px]">
        <span className="text-[12px] text-ink-500">
          {store.hydrated
            ? visible.length === 0
              ? "0 shown"
              : `${from + 1}–${from + page.length} of ${visible.length}`
            : "…"}
        </span>
        <span className="h-3.5 w-px bg-line" />
        {/* The filter is a heuristic, so its misses stay reachable — pulled
            rather than pushed, because announcing every newsletter would train
            the reviewer to ignore the banner that matters. */}
        <button onClick={showIgnored} className="text-[12px] text-ink-400 hover:text-ink-700">
          {ignored ? "Hide" : "Show"} mail that wasn&apos;t a certificate request
        </button>
        <div className="flex-1" />
        <span className="text-[12px] text-ink-400">Updates arrive on their own</span>
      </div>

      {ignored && (
        <div className="max-h-48 flex-none overflow-y-auto border-t border-line bg-surface-shell px-[22px] py-3">
          {ignored.length === 0 ? (
            <p className="text-[12px] text-ink-400">
              Nothing has been passed over since the server last started.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {ignored.map((m, i) => (
                <li key={i} className="text-[12px] leading-snug text-ink-700">
                  <span className="font-medium">{m.subject || "(no subject)"}</span>{" "}
                  <span className="text-ink-400">from {m.fromAddr}</span>
                  <br />
                  <span className="text-ink-400">{m.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {matching && (
        <MatchModal
          requestId={matching}
          onClose={() => setMatching(null)}
          // Identifying the insured was the missing judgement; the draft
          // follows from it, so land the reviewer on the document rather than
          // back on a list where they would only click through to it anyway.
          onMatched={(result) => {
            if (result?.certificate) router.push(`/certificate/${matching}`);
          }}
        />
      )}
    </div>
  );
}

/**
 * The action on a row. Filled brand orange: the row's action is the one thing
 * on it a reviewer is there to press, and at a glance down the list the column
 * of buttons is what tells them how much work is waiting.
 */
const ROW_ACTION =
  "h-[30px] w-full whitespace-nowrap rounded-[7px] bg-brand-500 px-3.5 text-[12.5px] font-semibold text-white transition hover:bg-brand-600 active:scale-[0.98] disabled:opacity-60";

/**
 * Numbered paging. Shows the first and last page always, and a window around
 * the current one, so the control stays the same width at 3 pages and at 300.
 */
function Pager({ page, pageCount, total, onGo }) {
  const numbers = [];
  for (let n = 1; n <= pageCount; n++) {
    if (n === 1 || n === pageCount || Math.abs(n - page) <= 1) numbers.push(n);
    else if (numbers[numbers.length - 1] !== "…") numbers.push("…");
  }

  const step = (delta) => () => onGo(Math.min(pageCount, Math.max(1, page + delta)));
  const box =
    "flex h-[30px] min-w-[30px] items-center justify-center rounded-[7px] px-2.5 text-[12.5px] font-semibold transition disabled:opacity-40";

  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5 border-b border-line-faint py-3">
      <button onClick={step(-1)} disabled={page === 1} className={`${box} border border-[#d7dbe2] text-ink-700 hover:bg-surface-hover`}>
        Previous
      </button>
      {numbers.map((n, i) =>
        n === "…" ? (
          <span key={`gap-${i}`} className="px-1 text-[12.5px] text-ink-400">
            …
          </span>
        ) : (
          <button
            key={n}
            onClick={() => onGo(n)}
            aria-current={n === page ? "page" : undefined}
            className={`${box} ${
              n === page
                ? "bg-brand-500 text-white"
                : "border border-[#d7dbe2] text-ink-700 hover:bg-surface-hover"
            }`}
          >
            {n}
          </button>
        )
      )}
      <button onClick={step(1)} disabled={page === pageCount} className={`${box} border border-[#d7dbe2] text-ink-700 hover:bg-surface-hover`}>
        Next
      </button>
      <span className="ml-2 text-[12px] text-ink-400">{total} in total</span>
    </div>
  );
}

/** A row of live work: two lines, an action, 62px. */
function LiveRow({ req, busy, onIdentify, onOpen }) {
  const needsIdentifying = !req.insuredName;
  const arriving = req.status === "new" || req.status === "interpreting";

  return (
    <div className="grid h-[62px] grid-cols-[30px_172px_minmax(0,1fr)_152px_74px] items-center gap-3.5 border-b border-line-soft px-[22px] transition hover:bg-surface-hover">
      {/* Unread reads as weight, like a mail client. The dot is the only other
          thing on this screen allowed to be orange. */}
      <span className={`h-[7px] w-[7px] rounded-full ${req.unread ? "bg-brand-500" : ""}`} />

      <span
        className={`truncate text-[13.5px] ${req.unread ? "font-semibold text-ink-900" : "text-ink-700"}`}
      >
        {req.fromName}
      </span>

      <div className="min-w-0">
        <p
          className={`truncate text-[13.5px] ${req.unread ? "font-semibold text-ink-900" : "text-ink-700"}`}
        >
          {req.subject}
        </p>
        <p className={`truncate text-[12px] ${req.autoSendError ? "font-medium text-red-600" : "text-ink-400"}`}>
          {reasonFor(req)}
        </p>
      </div>

      {arriving ? (
        <span className="whitespace-nowrap text-center text-[12px] text-ink-400">Reading…</span>
      ) : needsIdentifying ? (
        <button onClick={onIdentify} className={ROW_ACTION}>
          {req.status === "awaitingRequester" ? "Identify anyway" : "Identify insured"}
        </button>
      ) : (
        <button onClick={onOpen} disabled={busy} className={ROW_ACTION}>
          {busy ? "Preparing…" : req.certificateStatus === "issued" ? "View certificate" : "Review certificate"}
        </button>
      )}

      <span className="text-right text-[12px] text-ink-400">{formatTime(req.receivedAt)}</span>
    </div>
  );
}

/** A row of finished work: one line, 44px. For finding, not for reading. */
function ArchiveRow({ req, onOpen }) {
  return (
    <button
      onClick={onOpen}
      className="grid h-11 w-full grid-cols-[26px_168px_minmax(0,1fr)_150px_96px_66px] items-center gap-3.5 border-b border-line-faint px-[22px] text-left transition hover:bg-surface-hover"
    >
      <Icon.Check width={13} height={13} strokeWidth={2} className="text-ink-300" />
      <span className="truncate text-[13px] text-ink-600">{req.fromName}</span>
      <span className="truncate text-[13px] text-ink-600">{req.subject}</span>
      <span className="truncate text-[12px] text-ink-300">{req.insuredName || ""}</span>
      <span className="truncate text-[12px] text-ink-300">{req.certificateStatus === "issued" ? "issued" : ""}</span>
      <span className="text-right text-[12px] text-ink-300">{formatTime(req.receivedAt)}</span>
    </button>
  );
}
