"use client";

// Resolve a request the matcher would not commit to.
//
// The resolver abstains whenever a name is weak or two clients are too close to
// call, which is correct — but abstention is only useful if a person can then
// decide. This shows what the machine actually read from the email and what it
// was choosing between, then lets the reviewer pick.
//
// It deliberately shows the evidence rather than just a search box: a reviewer
// who can see "it read 'Smart Way' and found two companies that both start
// that way" makes a better decision than one handed a blank field.

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Icon } from "./icons";

export default function MatchModal({ requestId, onClose, onMatched }) {
  const store = useStore();
  const [context, setContext] = useState(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Load the evidence and seed the search with whatever was read from the email.
  useEffect(() => {
    let cancelled = false;
    store
      .getMatchContext(requestId)
      .then((ctx) => {
        if (cancelled) return;
        setContext(ctx);
        const first = ctx.interpretation.extracted[0]?.name ?? "";
        setQuery(first);
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  // Debounced so typing doesn't fire a query per keystroke.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      store
        .searchClients(query)
        .then((rows) => !cancelled && setResults(rows))
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function choose(clientId) {
    setBusy(true);
    setError(null);
    try {
      const result = await store.matchRequest(requestId, clientId);
      onMatched?.(result);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const extracted = context?.interpretation.extracted ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/45 p-4 backdrop-blur-sm sm:p-8">
      <div className="w-full max-w-2xl animate-scale-in overflow-hidden rounded-2xl bg-white shadow-pop">
        <div className="flex items-start gap-3 border-b border-ink-900/10 px-6 py-5">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <Icon.Database width={19} height={19} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold leading-tight text-ink-900">Identify the insured</h3>
            <p className="mt-0.5 truncate text-[13px] text-ink-500">
              {context?.request.subject ?? "Loading…"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 hover:bg-ink-900/5"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">{error}</div>
          )}

          {/* What the machine saw, and why it stopped. */}
          {context && (
            <div className="mb-5 rounded-xl bg-ink-900/[0.03] p-3.5">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-400">
                Why this needs you
              </p>
              <p className="mt-1 text-[13px] leading-snug text-ink-700">
                {context.interpretation.reason}
              </p>

              {extracted.length > 0 ? (
                <div className="mt-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">
                    Read from the email
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {extracted.map((e) => (
                      <button
                        key={e.name}
                        onClick={() => setQuery(e.name)}
                        title={e.evidence}
                        className="rounded-md bg-white px-2 py-1 text-[12px] font-medium text-ink-700 ring-1 ring-ink-900/10 hover:ring-accent-500"
                      >
                        {e.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-[12px] text-ink-500">
                  The email never named a company, so there is nothing to go on but the sender.
                </p>
              )}

              {context.request.bodyText && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[12px] font-medium text-accent-600">
                    Show the email
                  </summary>
                  <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-[12px] leading-snug text-ink-700 ring-1 ring-ink-900/10">
                    {context.request.bodyText}
                  </pre>
                </details>
              )}
            </div>
          )}

          <label className="text-[12px] font-semibold uppercase tracking-wide text-ink-400">
            Search the insured list
          </label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            autoFocus
            placeholder="Company name, client number, or a known alias"
            className="mt-1.5 w-full rounded-xl border border-ink-900/15 px-3.5 py-2.5 text-sm text-ink-900 outline-none focus:border-accent-500"
          />

          <div className="mt-3 space-y-1.5">
            {results.length === 0 && (
              <p className="py-6 text-center text-[13px] text-ink-400">
                No insured matches that search.
              </p>
            )}
            {results.map((c) => (
              <button
                key={c.id}
                onClick={() => choose(c.id)}
                disabled={busy}
                className="flex w-full items-center gap-3 rounded-xl border border-ink-900/10 px-3.5 py-3 text-left transition hover:border-accent-500 hover:bg-accent-500/5 disabled:opacity-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink-900">{c.legalName}</div>
                  <div className="truncate text-[12px] text-ink-500">
                    #{c.clientNumber} · {(c.addressLines ?? "").split("\n").join(", ")}
                  </div>
                </div>
                <Icon.Chevron width={16} height={16} className="flex-none text-ink-400" />
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-ink-900/10 bg-ink-900/[0.02] px-6 py-3.5">
          <p className="flex-1 text-[12px] text-ink-500">
            Your choice is recorded against your account — the certificate is then built from that
            insured&apos;s own policy records.
          </p>
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-none rounded-xl border border-ink-900/10 bg-white px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-900/5 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
