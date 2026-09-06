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
 * Which of the reviewer's three questions a request answers.
 *
 * This is the whole information architecture: what needs me, what is waiting on
 * someone else, what is finished. Every status maps to exactly one, so a
 * request is never in two places and never in none.
 */
function bucketOf(status) {
  if (status === "awaitingRequester") return "waiting";
  if (status === "approved" || status === "sent" || status === "rejected") return "done";
  return "needs";
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
  return req.insuredName ? "review" : "identify";
}

const GROUP_LABEL = {
  arriving: "Just arrived",
  identify: "Needs identifying",
  review: "Drafted, awaiting your review",
};

/** Why this request is sitting here, in the reviewer's own terms. */
function reasonFor(req) {
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
  { id: "needs", label: "Needs you" },
  { id: "waiting", label: "Waiting on requester" },
  { id: "done", label: "Done" },
  { id: "all", label: "All" },
];

export default function InboxView() {
  const store = useStore();
  const router = useRouter();
  const [tab, setTab] = useState("needs");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(50); // explicit paging, never infinite scroll
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
    const c = { needs: 0, waiting: 0, done: 0, all: store.requests.length };
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

  // Finished work is for finding, not reading, so it is grouped by day and
  // paged. Live work is grouped by what it asks of you and never truncated —
  // a reviewer must be able to see all of their outstanding work.
  const archive = tab === "done";
  const page = archive ? visible.slice(0, shown) : visible;

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
    return ["arriving", "identify", "review"].map((k) => byKey.get(k)).filter(Boolean);
  }, [page, archive]);

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
              onClick={() => {
                setTab(t.id);
                setShown(50);
              }}
              className={`flex h-9 items-center gap-[7px] ${on ? "shadow-[inset_0_-2px_0_#141b2d]" : ""}`}
            >
              <span className={`text-[13px] ${on ? "font-semibold text-ink-900" : "text-ink-500"}`}>
                {t.label}
              </span>
              <span
                className={`text-[12px] ${
                  t.id === "needs" && counts.needs > 0 ? "font-semibold text-brand-500" : "text-ink-400"
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
              {query ? "Nothing matches that" : tab === "needs" ? "Nothing waiting on you" : "Nothing here"}
            </p>
            <p className="text-[13.5px] text-ink-500">
              {query
                ? "Try a company name, a sender, or a certificate number."
                : tab === "needs"
                  ? "Every request that came in has been answered."
                  : "Requests will appear here as they arrive."}
            </p>
            {!query && tab === "needs" && (
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

        {/* Explicit, so a reviewer can tell how much they have not seen. */}
        {archive && visible.length > page.length && (
          <div className="flex h-[52px] items-center justify-center gap-3 border-b border-line-faint">
            <button
              onClick={() => setShown((n) => n + 50)}
              className="h-[30px] rounded-[7px] border border-[#d7dbe2] px-4 text-[12.5px] font-semibold text-ink-700 transition hover:bg-surface-hover"
            >
              Load 50 more
            </button>
            <span className="text-[12px] text-ink-400">
              {page.length} of {visible.length} shown
            </span>
          </div>
        )}
      </div>

      {/* ───────────────── footer ───────────────── */}
      <div className="flex h-[38px] flex-none items-center gap-3.5 border-t border-line bg-surface-sunken px-[22px]">
        <span className="text-[12px] text-ink-500">
          {store.hydrated ? `${visible.length} shown` : "…"}
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

/** A row of live work: two lines, an action, 62px. */
function LiveRow({ req, busy, onIdentify, onOpen }) {
  const needsIdentifying = !req.insuredName;
  const arriving = req.status === "new" || req.status === "interpreting";

  return (
    <div className="grid h-[62px] grid-cols-[30px_172px_minmax(0,1fr)_auto_74px] items-center gap-3.5 border-b border-line-soft px-[22px] transition hover:bg-surface-hover">
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
        <p className="truncate text-[12px] text-ink-400">{reasonFor(req)}</p>
      </div>

      {arriving ? (
        <span className="whitespace-nowrap text-[12px] text-ink-400">Reading…</span>
      ) : needsIdentifying ? (
        // Outline, not filled. A filled accent button per row means twenty of
        // them on a busy morning, and an accent that appears twenty times has
        // stopped pointing at anything. Orange is left to the unread dot and
        // the "Needs you" count; the grouping already says this is your work.
        <button
          onClick={onIdentify}
          className="h-[30px] whitespace-nowrap rounded-[7px] border border-[#d7dbe2] bg-white px-3.5 text-[12.5px] font-semibold text-ink-900 transition hover:bg-surface-hover active:scale-[0.98]"
        >
          {req.status === "awaitingRequester" ? "Identify anyway" : "Identify insured"}
        </button>
      ) : (
        <button
          onClick={onOpen}
          disabled={busy}
          className="h-[30px] whitespace-nowrap rounded-[7px] border border-[#d7dbe2] bg-white px-3.5 text-[12.5px] font-semibold text-ink-900 transition hover:bg-surface-hover disabled:opacity-60"
        >
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
