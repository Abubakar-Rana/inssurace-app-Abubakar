"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import AcordOverlay from "@/components/AcordOverlay";
import { useStore } from "@/lib/store";
import { Icon } from "@/components/icons";

/**
 * One section of the context rail.
 *
 * A rule between sections rather than a card each: the document is the hero on
 * this screen, and a column of shadowed cards competes with it.
 */
function Panel({ title, children }) {
  return (
    <section className="border-b border-line-soft px-5 py-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">{title}</h2>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function Field({ label, value }) {
  return (
    <div className="mb-2.5 last:mb-0">
      <dt className="text-[11px] uppercase tracking-[0.05em] text-ink-400">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-[12.5px] leading-snug text-ink-700">
        {value || "—"}
      </dd>
    </div>
  );
}

export default function CertificatePage() {
  const { id } = useParams(); // request id
  const store = useStore();

  const request = store.getRequest(id);
  const [record, setRecord] = useState(null); // certificate row from the API
  const [cert, setCert] = useState(null); // its snapshot, locally edited
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved
  const [sendTo, setSendTo] = useState(null); // recipient being confirmed
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState([]); // past deliveries
  const [formW, setFormW] = useState(880);
  const saveTimer = useRef(null);

  /**
   * Size the form to the column it lands in.
   *
   * A CALLBACK ref, not an effect keyed on the request. The wrapper only
   * mounts after the certificate has been assembled, which happens later than
   * `request` arriving — so an effect keyed on the request id ran while the
   * node was still null, returned early, and never ran again. The form then
   * kept its initial 880px in an 828px column for the life of the page. A
   * callback ref fires when the node actually appears, which is the only
   * moment worth measuring.
   */
  const roRef = useRef(null);
  const wrapRef = useCallback((el) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const update = () => {
      const avail = el.clientWidth - 32; // the wrapper's own padding
      setFormW(Math.max(620, Math.min(avail, 1120)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    roRef.current = ro;
  }, []);

  // Fetch the certificate, assembling one if the request has none yet (which
  // happens on direct navigation or a refresh). Generation is idempotent
  // server-side, so this cannot produce duplicates.
  useEffect(() => {
    if (!store.hydrated || !request) return;
    let cancelled = false;

    (async () => {
      try {
        const rec = request.certificateId
          ? await store.getCertificate(request.certificateId)
          : await store.generateCertificate(request.id);
        if (cancelled) return;
        setRecord(rec);
        setCert(rec.snapshot);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.hydrated, request?.id, request?.certificateId]);

  // Edits are saved on a short debounce rather than per keystroke.
  const onCertChange = useCallback(
    (next) => {
      setCert(next);
      if (!record || record.status !== "draft") return;
      setSaveState("saving");
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          const saved = await store.updateCertificate(record.id, next);
          setRecord(saved);
          setSaveState("saved");
        } catch (err) {
          setError(err.message);
          setSaveState("idle");
        }
      }, 600);
    },
    [record, store]
  );

  // Show what has already gone out, so a reviewer never sends twice by accident.
  useEffect(() => {
    if (!record || record.status === "draft") return;
    let cancelled = false;
    store
      .listDeliveries(record.id)
      .then((rows) => !cancelled && setSent(rows))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id, record?.status]);

  async function onSend() {
    setSending(true);
    setError(null);
    try {
      const delivery = await store.sendCertificate(record.id, sendTo);
      setSent((prev) => [...prev, { id: delivery.deliveryId, toAddr: delivery.to, sentAt: new Date().toISOString() }]);
      setSendTo(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function onApprove() {
    setBusy(true);
    setError(null);
    try {
      // Flush any pending edit first, so approval hashes what is on screen.
      clearTimeout(saveTimer.current);
      if (record.status === "draft") await store.updateCertificate(record.id, cert);
      const issued = await store.approveCertificate(record.id);
      setRecord(issued);
      setCert(issued.snapshot);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!store.hydrated) {
    return (
      <AppShell>
        <div className="flex h-[60vh] items-center justify-center text-ink-400">Loading…</div>
      </AppShell>
    );
  }

  if (!request) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md rounded-2xl bg-white p-8 text-center shadow-card">
          <h2 className="text-lg font-bold text-ink-900">Request not found</h2>
          <p className="mt-1 text-sm text-ink-500">This certificate request no longer exists.</p>
          <Link href="/" className="mt-4 inline-block rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white">
            Back to inbox
          </Link>
        </div>
      </AppShell>
    );
  }

  if (error && !cert) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md rounded-2xl bg-white p-8 text-center shadow-card">
          <h2 className="text-lg font-bold text-ink-900">Could not load the certificate</h2>
          <p className="mt-1 text-sm text-ink-500">{error}</p>
          <Link href="/" className="mt-4 inline-block rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white">
            Back to inbox
          </Link>
        </div>
      </AppShell>
    );
  }

  if (!cert || !record) {
    return (
      <AppShell>
        <div className="flex h-[60vh] items-center justify-center text-ink-400">
          Assembling certificate from policy data…
        </div>
      </AppShell>
    );
  }

  const issued = record.status !== "draft";
  const pdfUrl = store.certificatePdfUrl(record.id);

  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col">
        {/* ───────────── identity + the two distinct acts ─────────────
            Approving issues the document; sending it is a separate, later,
            human act. Only ever one filled button, so the accent still means
            "this is the thing to do". */}
        <div className="no-print flex h-14 flex-none items-center gap-3.5 border-b border-line px-5">
          <Link
            href="/"
            title="Back to the inbox"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-ink-500 transition hover:bg-surface-hover hover:text-ink-900"
          >
            <Icon.Chevron width={17} height={17} className="rotate-180" />
          </Link>

          <div className="flex min-w-0 items-baseline gap-2.5">
            <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-ink-900">
              {record.certificateNumber}
            </h1>
            <span className="whitespace-nowrap text-[12.5px] text-ink-400">
              Revision {record.revision ?? 0}
            </span>
          </div>

          {/* A state, not a warning: an outline, no fill. */}
          <span className="flex h-5 flex-none items-center rounded-[5px] border border-[#d7dbe2] px-2 text-[11px] font-semibold uppercase tracking-[0.03em] text-ink-600">
            {issued ? "Issued" : "Draft"}
          </span>

          <span className="hidden min-w-0 truncate text-[12.5px] text-ink-400 md:block">
            {cert.insured.name}
            {request.clientNumber ? ` · #${request.clientNumber}` : ""}
          </span>

          {saveState === "saving" && <span className="text-[11.5px] text-ink-400">Saving…</span>}
          {saveState === "saved" && <span className="text-[11.5px] text-ink-500">Saved</span>}

          <div className="flex-1" />

          <div className="flex flex-none items-center gap-2">
            <button
              onClick={() => setEditing((e) => !e)}
              disabled={issued}
              title={
                issued
                  ? "Issued certificates cannot be edited. A correction is a new revision."
                  : undefined
              }
              className={`inline-flex h-8 items-center gap-1.5 rounded-[7px] px-3.5 text-[12.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                editing
                  ? "border border-ink-900 bg-ink-900 text-white"
                  : "border border-[#d7dbe2] bg-white text-ink-700 hover:bg-surface-hover"
              }`}
            >
              {editing ? <Icon.Check width={14} height={14} /> : <Icon.Edit width={14} height={14} />}
              {editing ? "Done editing" : "Edit fields"}
            </button>

            {/* Served from the stored snapshot, so the file a reviewer
                downloads is the same bytes approval hashed. */}
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-[#d7dbe2] bg-white px-3.5 text-[12.5px] font-medium text-ink-700 transition hover:bg-surface-hover"
            >
              <Icon.Download width={14} height={14} /> Download
            </a>

            {!issued ? (
              <button
                onClick={onApprove}
                disabled={busy}
                className="inline-flex h-8 items-center rounded-[7px] bg-brand-500 px-4 text-[12.5px] font-semibold text-white transition hover:bg-brand-600 active:scale-[0.98] disabled:opacity-50"
              >
                {busy ? "Approving…" : "Approve & issue"}
              </button>
            ) : (
              <button
                onClick={() => setSendTo(request.from)}
                className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-brand-500 px-4 text-[12.5px] font-semibold text-white transition hover:bg-brand-600 active:scale-[0.98]"
              >
                <Icon.Send width={14} height={14} />
                {sent.length ? "Send again" : "Send to requester"}
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="no-print flex-none border-b border-line bg-surface-hover px-5 py-2.5 text-[12.5px] text-ink-700">
            {error}
          </div>
        )}

        {/* Confirming the recipient is the last human checkpoint before a
            document leaves the building, so the address is editable and the
            send is never one click from the toolbar. */}
        {sendTo !== null && (
          <div className="no-print flex-none border-b border-line bg-surface-sunken px-5 py-3.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[12.5px] font-semibold text-ink-900">Send to</span>
              <input
                value={sendTo}
                onChange={(e) => setSendTo(e.target.value)}
                spellCheck={false}
                placeholder="recipient@example.com"
                className="h-8 w-full max-w-sm rounded-[7px] border border-[#d7dbe2] px-3 text-[12.5px] text-ink-900 outline-none focus:border-brand-500"
              />
              <button
                onClick={onSend}
                disabled={sending || !sendTo.trim()}
                className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-brand-500 px-4 text-[12.5px] font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
              >
                <Icon.Send width={14} height={14} /> {sending ? "Sending…" : "Confirm & send"}
              </button>
              <button
                onClick={() => setSendTo(null)}
                disabled={sending}
                className="h-8 rounded-[7px] px-3 text-[12.5px] font-medium text-ink-500 transition hover:text-ink-900"
              >
                Cancel
              </button>
            </div>
            <p className="mt-2 text-[11.5px] text-ink-400">
              Attached as a PDF and sent as a reply in the original email thread.
              {sent.length > 0 &&
                ` Already sent to ${sent[sent.length - 1].toAddr} — sending again delivers the same document a second time.`}
            </p>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          {/* ───────────── the document ───────────── */}
          <div className="min-w-0 flex-1 overflow-y-auto bg-surface-hover">
            {editing && (
              <div className="no-print sticky top-0 z-10 border-b border-line bg-white px-5 py-2 text-[12.5px] text-ink-600">
                Edit mode — click any field on the form to change it. Changes save to the draft
                automatically.
              </div>
            )}

            <div ref={wrapRef} className="px-4 py-5">
              <div className="mx-auto" style={{ width: formW }}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
                  ACORD {record.acordEdition ?? "25"}
                </p>
                <div className="shadow-[0_1px_3px_rgba(20,27,45,0.10),0_8px_24px_-8px_rgba(20,27,45,0.18)] ring-1 ring-[#cfd4dc]">
                  <AcordOverlay cert={cert} editing={editing} onChange={onCertChange} width={formW} />
                </div>

                {/* The ACORD 101 exists only when the fleet or remarks overflow
                    page 1. It is stacked rather than hidden behind a tab: a
                    reviewer approves the whole document, not its first page. */}
                {cert.acord101 && (
                  <>
                    <p className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
                      ACORD 101 · Additional remarks
                    </p>
                    <div className="shadow-[0_1px_3px_rgba(20,27,45,0.10),0_8px_24px_-8px_rgba(20,27,45,0.18)] ring-1 ring-[#cfd4dc]">
                      <AcordOverlay
                        cert={cert}
                        editing={editing}
                        onChange={onCertChange}
                        width={formW}
                        sheet="acord101"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ───────────── where each value came from ───────────── */}
          <aside className="no-print hidden w-[296px] flex-none overflow-y-auto border-l border-line bg-white xl:block">
            <Panel title="The request">
              <p className="text-[13px] font-medium leading-snug text-ink-900">{request.subject}</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-ink-500">
                {request.fromName}
                <br />
                <span className="text-ink-400">{request.from}</span>
              </p>
            </Panel>

            {/* The one field on the form that comes from the email rather than
                the agency's records, so it says so. */}
            <Panel title="Certificate holder">
              <p className="whitespace-pre-line text-[12.5px] leading-snug text-ink-700">
                {[cert.holder.name, cert.holder.address].filter(Boolean).join("\n") || "—"}
              </p>
              <p className="mt-2 text-[11.5px] leading-snug text-ink-400">
                Read from the sender&apos;s signature block, not from your client records — the
                holder is whoever wrote in.
              </p>
            </Panel>

            <Panel title="From policy records">
              <Field label="Named insured" value={`${cert.insured.name}\n${cert.insured.address}`} />
              <Field
                label="Insurers"
                value={(cert.insurers || [])
                  .map((i) => `${i.letter}: ${i.name} (${i.naic})`)
                  .join("\n")}
              />
              <Field label="Producer" value={cert.producer.name} />
              <p className="mt-2 text-[11.5px] leading-snug text-ink-400">
                Every limit, policy number and date was read from the database. Nothing is typed or
                inferred.
              </p>
            </Panel>

            {sent.length > 0 && (
              <Panel title={sent.length === 1 ? "Delivered" : `Delivered ${sent.length} times`}>
                <div className="flex flex-col gap-2.5">
                  {sent.map((d, i) => (
                    <div key={i}>
                      <p className="text-[12.5px] text-ink-700">{d.toAddr}</p>
                      {d.sentAt && (
                        <p className="text-[11.5px] text-ink-400">{String(d.sentAt).split("T")[0]}</p>
                      )}
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            {issued && (
              <Panel title="Frozen">
                <p className="text-[12px] leading-relaxed text-ink-500">
                  This document is issued and cannot be changed. A correction is a new revision of
                  the same certificate number, so a holder who received {record.certificateNumber}{" "}
                  sees that number again.
                </p>
              </Panel>
            )}
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
