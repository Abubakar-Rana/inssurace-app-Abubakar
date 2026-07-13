"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import AcordOverlay from "@/components/AcordOverlay";
import DistributeModal from "@/components/DistributeModal";
import { useStore } from "@/lib/store";
import { buildCertificate } from "@/lib/seed";
import { downloadCertificatePdf, certFileName } from "@/lib/acordPdf";
import { Icon } from "@/components/icons";

function Provenance({ title, source, icon: I, tone, items }) {
  const tones = {
    email: "bg-brand-50 text-brand-700 border-brand-200",
    ams: "bg-emerald-50 text-emerald-700 border-emerald-200",
  };
  return (
    <div className="rounded-2xl bg-white p-4 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tones[tone]}`}>
          <I width={13} height={13} /> {source}
        </span>
        <h3 className="text-sm font-bold text-ink-900">{title}</h3>
      </div>
      <dl className="space-y-2">
        {items.map((it) => (
          <div key={it.label}>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{it.label}</dt>
            <dd className="whitespace-pre-line text-[13px] font-medium leading-snug text-ink-800">{it.value || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function CertificatePage() {
  const { id } = useParams();
  const router = useRouter();
  const store = useStore();

  const request = store.getRequest(id);
  const [editing, setEditing] = useState(false);
  const [distribute, setDistribute] = useState(null); // 'auto' | 'review'
  const [formW, setFormW] = useState(880);
  const wrapRef = useRef(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const avail = el.clientWidth - 32; // padding
      setFormW(Math.max(620, Math.min(avail, 1120)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [request?.id]);

  // Ensure a certificate exists (handles direct navigation / refresh).
  useEffect(() => {
    if (store.hydrated && request && !request.certificate) {
      store.generateCertificate(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.hydrated, request?.id]);

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

  const cert = request.certificate || buildCertificate(request);
  const distributed = request.status === "distributed";

  function onCertChange(next) {
    store.updateCertificate(id, next);
  }

  function onDistributeConfirm(methodLabel) {
    store.distribute(id, methodLabel);
    setDistribute(null);
    router.push("/");
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-[1600px]">
        {/* Toolbar */}
        <div className="no-print mb-5 flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-card lg:flex-row lg:items-center">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-900/5">
              <Icon.Chevron width={18} height={18} className="rotate-180" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-ink-900">{cert.insured.name}</h1>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    distributed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {distributed ? "Distributed" : "Ready to review"}
                </span>
              </div>
              <p className="text-[12px] text-ink-500">
                ACORD 25 · Cert #{cert.certificateNumber} · {request.id}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            <button
              onClick={() => setEditing((e) => !e)}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition ${
                editing
                  ? "bg-brand-500 text-white hover:bg-brand-600"
                  : "border border-ink-900/10 bg-white text-ink-800 hover:bg-ink-900/5"
              }`}
            >
              {editing ? <Icon.Check width={16} height={16} /> : <Icon.Edit width={16} height={16} />}
              {editing ? "Done editing" : "Edit form"}
            </button>
            <button
              onClick={() => downloadCertificatePdf(cert, certFileName(cert))}
              className="inline-flex items-center gap-2 rounded-xl border border-ink-900/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink-800 hover:bg-ink-900/5"
            >
              <Icon.Download width={16} height={16} /> PDF
            </button>

            {!distributed && (
              <>
                <div className="mx-1 hidden h-6 w-px bg-ink-900/10 sm:block" />
                <button
                  onClick={() => setDistribute("review")}
                  className="inline-flex items-center gap-2 rounded-xl border border-accent-500/30 bg-accent-500/5 px-4 py-2.5 text-sm font-semibold text-accent-600 hover:bg-accent-500/10"
                >
                  <Icon.Send width={16} height={16} /> Review &amp; Send
                </button>
                <button
                  onClick={() => setDistribute("auto")}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 active:scale-[0.98]"
                >
                  <Icon.Bolt width={16} height={16} /> Auto-Disburse
                </button>
              </>
            )}
          </div>
        </div>

        {distributed && (
          <div className="no-print mb-5 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <Icon.Check width={18} height={18} />
            This certificate was distributed via <span className="font-semibold">{request.distribution?.method}</span> on{" "}
            {request.distribution?.at}.
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
          {/* Left: data provenance */}
          <div className="no-print space-y-4">
            <div className="rounded-2xl bg-gradient-to-br from-ink-900 to-ink-800 p-4 text-white shadow-card">
              <div className="mb-1 flex items-center gap-2 text-brand-300">
                <Icon.Sparkle width={16} height={16} />
                <span className="text-[11px] font-bold uppercase tracking-wide">Auto-generated</span>
              </div>
              <p className="text-[13px] leading-snug text-white/80">
                This certificate was assembled automatically from the inbound email and matched AMS360 policy data. Review any
                field, edit if needed, then distribute.
              </p>
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-[12px]">
                <Icon.Database width={14} height={14} className="text-emerald-300" />
                Matched to <span className="font-semibold">#{request.ams.clientNumber}</span>
                <span className="ml-auto font-semibold text-emerald-300">
                  {Math.round((request.ams.matchConfidence || 0) * 100)}% match
                </span>
              </div>
            </div>

            <Provenance
              title="From email request"
              source="Email"
              icon={Icon.Mail}
              tone="email"
              items={[
                { label: "Certificate Holder", value: `${cert.holder.name}\n${cert.holder.address}` },
                { label: "Requester", value: request.email.from },
                { label: "Requested coverages", value: (request.email.requestedCoverages || []).join(", ") },
              ]}
            />

            <Provenance
              title="From AMS360"
              source="AMS360"
              icon={Icon.Database}
              tone="ams"
              items={[
                { label: "Named Insured", value: `${cert.insured.name}\n${cert.insured.address}` },
                { label: "Insurers", value: (cert.insurers || []).map((i) => `${i.letter}: ${i.name} (${i.naic})`).join("\n") },
                { label: "Producer", value: cert.producer.name },
              ]}
            />
          </div>

          {/* Right: the ACORD sheet */}
          <div>
            {editing && (
              <div className="no-print mb-3 flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-[13px] font-medium text-brand-700 animate-fade-up">
                <Icon.Edit width={15} height={15} />
                Edit mode — click any highlighted field to change it. Changes save automatically.
              </div>
            )}
            <div ref={wrapRef} className="overflow-x-auto rounded-2xl bg-white p-4 shadow-card sm:p-4">
              <div className="mx-auto" style={{ width: formW }}>
                <div className="ring-1 ring-ink-900/10">
                  <AcordOverlay cert={cert} editing={editing} onChange={onCertChange} width={formW} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {distribute && (
        <DistributeModal
          mode={distribute}
          request={request}
          cert={cert}
          onClose={() => setDistribute(null)}
          onConfirm={onDistributeConfirm}
        />
      )}
    </AppShell>
  );
}
