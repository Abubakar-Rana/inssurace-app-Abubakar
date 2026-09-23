"use client";

// Every certificate the agency has produced, newest first — including
// superseded revisions, because a correction does not erase what a holder
// already received.

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { Icon } from "@/components/icons";

const STATUS = {
  draft: { label: "Draft", cls: "bg-amber-100 text-amber-700" },
  issued: { label: "Issued", cls: "bg-emerald-100 text-emerald-700" },
  voided: { label: "Voided", cls: "bg-ink-900/5 text-ink-500" },
};

// Parsed by hand rather than with Date, to keep server and client output
// identical — see the dates convention in CLAUDE.md.
function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("T")[0].split("-");
  return y && m && d ? `${m}/${d}/${y}` : "";
}

export default function CertificatesPage() {
  const store = useStore();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    store
      .listCertificates()
      .then(setRows)
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell inboxCount={store.requests.filter((r) => r.status === "new").length}>
      <div className="mx-auto max-w-5xl px-5 py-6">
        <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-brand-600">
          <Icon.Doc width={16} height={16} /> Certificates
        </div>
        <h1 className="text-[26px] font-bold tracking-tight text-ink-900">Issued Certificates</h1>
        <p className="mt-1 text-sm text-ink-500">
          Every certificate produced, including superseded revisions. A correction is a new
          revision of the same number — the original is never rewritten.
        </p>

        {error && (
          <div className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {rows === null && !error && <p className="mt-6 text-sm text-ink-500">Loading…</p>}

        {rows?.length === 0 && (
          <p className="mt-6 rounded-2xl border border-dashed border-ink-900/10 bg-white/60 px-5 py-8 text-center text-sm text-ink-500">
            Nothing issued yet. Generate one from the{" "}
            <Link href="/inbox" className="font-medium text-accent-600 hover:underline">
              request inbox
            </Link>
            .
          </p>
        )}

        {rows?.length > 0 && (
          <div className="mt-6 overflow-x-auto rounded-2xl bg-white shadow-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-ink-900/10 text-[11px] uppercase tracking-wide text-ink-400">
                <tr>
                  <th className="px-4 py-3 font-semibold">Certificate</th>
                  <th className="px-4 py-3 font-semibold">Insured</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Delivered</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const meta = STATUS[c.status] ?? STATUS.draft;
                  return (
                    <tr key={c.id} className="border-b border-ink-900/5 last:border-0">
                      <td className="px-4 py-3">
                        <span className="font-mono text-[13px] font-medium text-ink-900">
                          {c.certificateNumber}
                        </span>
                        {c.revision > 0 && (
                          <span className="ml-1.5 rounded bg-ink-900/5 px-1.5 py-0.5 text-[11px] text-ink-600">
                            rev {c.revision}
                          </span>
                        )}
                        <div className="text-[11px] text-ink-400">{formatDate(c.createdAt)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink-800">{c.insuredName}</div>
                        <div className="text-[11px] text-ink-400">#{c.clientNumber}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${meta.cls}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-ink-600">
                        {c.sentTo ? (
                          <>
                            <div className="truncate">{c.sentTo}</div>
                            <div className="text-[11px] text-ink-400">
                              {formatDate(c.sentAt)}
                              {c.deliveryCount > 1 ? ` · ${c.deliveryCount} sends` : ""}
                            </div>
                          </>
                        ) : (
                          <span className="text-ink-400">Not sent</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1.5">
                          <a
                            href={store.certificatePdfUrl(c.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-ink-900/10 px-2.5 py-1.5 text-[12px] font-medium text-ink-700 hover:bg-ink-900/5"
                          >
                            PDF
                          </a>
                          {c.requestId && (
                            <Link
                              href={`/certificate/${c.requestId}`}
                              className="rounded-lg border border-ink-900/10 px-2.5 py-1.5 text-[12px] font-medium text-ink-700 hover:bg-ink-900/5"
                            >
                              Open
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
