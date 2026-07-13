"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { Icon } from "./icons";
import ProcessingModal from "./ProcessingModal";

function formatTime(iso) {
  // iso like "2026-07-08T13:12:00" — format without Date to avoid TZ/hydration issues
  const t = (iso || "").split("T")[1] || "";
  const [hStr, m] = t.split(":");
  let h = parseInt(hStr || "0", 10);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

const STATUS_META = {
  new: { label: "New request", cls: "bg-brand-100 text-brand-700" },
  ready: { label: "Ready to review", cls: "bg-amber-100 text-amber-700" },
  distributed: { label: "Distributed", cls: "bg-emerald-100 text-emerald-700" },
};

function Stat({ icon: I, label, value, tone = "brand" }) {
  const tones = {
    brand: "from-brand-400 to-brand-600",
    blue: "from-accent-500 to-accent-600",
    emerald: "from-emerald-400 to-emerald-600",
    slate: "from-ink-500 to-ink-700",
  };
  return (
    <div className="flex items-center gap-3.5 rounded-2xl bg-white p-4 shadow-card">
      <span className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-white ${tones[tone]}`}>
        <I width={20} height={20} />
      </span>
      <div>
        <p className="text-2xl font-bold leading-none text-ink-900">{value}</p>
        <p className="mt-1 text-[12px] font-medium text-ink-500">{label}</p>
      </div>
    </div>
  );
}

function CoverageChip({ text }) {
  return (
    <span className="rounded-md bg-ink-900/5 px-2 py-0.5 text-[11px] font-medium text-ink-600">
      {text}
    </span>
  );
}

export default function InboxView() {
  const store = useStore();
  const router = useRouter();
  const [processing, setProcessing] = useState(null); // request being generated
  const [justSimulated, setJustSimulated] = useState(null);

  const counts = useMemo(() => {
    const c = { new: 0, ready: 0, distributed: 0 };
    store.requests.forEach((r) => {
      c[r.status] = (c[r.status] || 0) + 1;
    });
    return c;
  }, [store.requests]);

  function handleGenerate(req) {
    if (req.status === "new") {
      setProcessing(req);
    } else {
      router.push(`/certificate/${req.id}`);
    }
  }

  function onProcessingComplete() {
    const id = processing.id;
    store.generateCertificate(id);
    setProcessing(null);
    router.push(`/certificate/${id}`);
  }

  function handleSimulate() {
    const id = store.simulateIncoming();
    setJustSimulated(id);
    setTimeout(() => setJustSimulated(null), 2500);
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-brand-600">
            <Icon.Inbox width={16} height={16} /> Request Inbox
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-ink-900">Certificate Requests</h1>
          <p className="mt-1 text-sm text-ink-500">
            Inbound COI requests are triggered from email and auto-matched to AMS360 client records.
          </p>
        </div>
        <button
          onClick={handleSimulate}
          className="group inline-flex items-center gap-2 self-start rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 active:scale-[0.98]"
        >
          <Icon.Bolt width={17} height={17} className="transition group-hover:scale-110" />
          Simulate incoming request
        </button>
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Icon.Mail} label="New requests" value={counts.new} tone="brand" />
        <Stat icon={Icon.Doc} label="Ready to review" value={counts.ready} tone="blue" />
        <Stat icon={Icon.Send} label="Distributed" value={counts.distributed} tone="emerald" />
        <Stat icon={Icon.Clock} label="Avg. handle time" value="38s" tone="slate" />
      </div>

      {/* List */}
      <div className="mt-6 space-y-3">
        {store.requests.map((req) => {
          const meta = STATUS_META[req.status];
          const isNew = justSimulated === req.id;
          return (
            <div
              key={req.id}
              className={`group rounded-2xl border bg-white p-4 shadow-card transition hover:shadow-pop sm:p-5 ${
                isNew ? "border-brand-300 ring-2 ring-brand-200 animate-fade-up" : "border-transparent"
              }`}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                {/* Left: sender + subject */}
                <div className="flex min-w-0 flex-1 items-start gap-3.5">
                  <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-ink-900/5 text-ink-500">
                    <Icon.Mail width={20} height={20} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${meta.cls}`}>
                        {meta.label}
                      </span>
                      {req.priority === "high" && req.status === "new" && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-600">
                          High priority
                        </span>
                      )}
                      <span className="text-[12px] text-ink-400">
                        {req.id} · Today · {formatTime(req.email.receivedAt)}
                      </span>
                    </div>
                    <p className="mt-1.5 truncate text-[15px] font-semibold text-ink-900">
                      {req.email.subject}
                    </p>
                    <p className="mt-0.5 truncate text-[13px] text-ink-500">
                      From <span className="font-medium text-ink-700">{req.email.fromName}</span> · {req.email.from}
                    </p>

                    {/* AMS match + coverage chips */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        <Icon.Database width={13} height={13} />
                        AMS match: {req.ams.clientName} · #{req.ams.clientNumber}
                      </span>
                      {(req.email.requestedCoverages || []).map((c) => (
                        <CoverageChip key={c} text={c} />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right: action */}
                <div className="flex flex-none items-center gap-2 sm:flex-col sm:items-end">
                  <button
                    onClick={() => handleGenerate(req)}
                    className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] sm:w-auto ${
                      req.status === "new"
                        ? "bg-accent-500 text-white hover:bg-accent-600"
                        : "border border-ink-900/10 bg-white text-ink-800 hover:bg-ink-900/5"
                    }`}
                  >
                    {req.status === "new" ? (
                      <>
                        <Icon.Bolt width={16} height={16} /> Generate certificate
                      </>
                    ) : req.status === "ready" ? (
                      <>
                        <Icon.Edit width={16} height={16} /> Review certificate
                      </>
                    ) : (
                      <>
                        <Icon.Doc width={16} height={16} /> View certificate
                      </>
                    )}
                  </button>
                  {req.status === "distributed" && req.distribution && (
                    <span className="text-[11px] text-ink-400">
                      via {req.distribution.method}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 flex items-center justify-between rounded-2xl border border-dashed border-ink-900/10 bg-white/60 px-5 py-4">
        <p className="text-sm text-ink-500">
          Done exploring? Reset the demo to restore the original sample requests.
        </p>
        <button
          onClick={store.resetDemo}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-600 hover:bg-ink-900/5"
        >
          Reset demo
        </button>
      </div>

      {processing && (
        <ProcessingModal
          request={processing}
          onComplete={onProcessingComplete}
          onCancel={() => setProcessing(null)}
        />
      )}
    </div>
  );
}
