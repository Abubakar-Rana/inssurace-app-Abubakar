"use client";

import { useState } from "react";
import { Icon } from "./icons";
import { downloadCertificatePdf, certFileName } from "@/lib/acordPdf";

const METHODS = [
  { key: "download", label: "Download (Individual PDF)", icon: Icon.Download, desc: "Save the certificate as a PDF to send manually." },
  { key: "email", label: "InsurLink Email Service", icon: Icon.Mail, desc: "Email the certificate to the requester automatically." },
  { key: "none", label: "Do Not Distribute", icon: Icon.Doc, desc: "Save the issued certificate without sending." },
];

export default function DistributeModal({ mode, request, cert, onClose, onConfirm }) {
  const auto = mode === "auto";
  const [method, setMethod] = useState(auto ? "email" : "");
  const [sent, setSent] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);

  const recipient = request.email.from;
  const chosen = METHODS.find((m) => m.key === method);

  function confirm() {
    const label = method === "email" ? "InsurLink Email" : method === "download" ? "PDF Download" : "Saved (not sent)";
    if (method === "download") {
      // Generate the real filled ACORD 25 PDF from the official template.
      downloadCertificatePdf(cert, certFileName(cert));
    }
    setSent(true);
    setTimeout(() => onConfirm(label), 900);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/45 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-lg animate-scale-in overflow-y-auto rounded-2xl bg-white shadow-pop">
        {/* header */}
        <div className={`flex items-center gap-3 px-6 py-5 text-white ${auto ? "bg-gradient-to-br from-emerald-500 to-emerald-600" : "bg-gradient-to-br from-accent-500 to-accent-600"}`}>
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20">
            {auto ? <Icon.Bolt width={22} height={22} /> : <Icon.Send width={20} height={20} />}
          </span>
          <div>
            <h3 className="text-lg font-bold leading-tight">{auto ? "Auto-Disburse Certificate" : "Review & Send"}</h3>
            <p className="text-sm text-white/85">
              {cert.insured.name} · Cert #{cert.certificateNumber}
            </p>
          </div>
          <button onClick={onClose} className="ml-auto rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white">
            <Icon.Close width={18} height={18} />
          </button>
        </div>

        {sent ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center animate-fade-up">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <Icon.Check width={30} height={30} />
            </span>
            <h4 className="text-lg font-bold text-ink-900">Certificate issued</h4>
            <p className="max-w-sm text-sm text-ink-500">
              {method === "email"
                ? `Sent to ${recipient} via InsurLink Email Service.`
                : method === "download"
                ? "PDF generated — check your downloads."
                : "Saved to the client's issued certificates."}
            </p>
          </div>
        ) : (
          <div className="px-6 py-5">
            {auto ? (
              <>
                <p className="text-sm text-ink-600">
                  This certificate will be delivered to the original requester automatically. No manual review required.
                </p>
                <div className="mt-4 space-y-2 rounded-xl border border-ink-900/10 bg-ink-900/[0.02] p-4">
                  <Row label="Method" value="InsurLink Email Service" icon={Icon.Mail} />
                  <Row label="Recipient" value={recipient} />
                  <Row label="Holder" value={cert.holder.name} />
                  <Row label="Coverages" value={activeCoverages(cert)} />
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-ink-600">Choose how you'd like to distribute this certificate.</p>

                {/* dropdown (renders in-flow so the modal grows instead of clipping) */}
                <div className="mt-3">
                  <button
                    onClick={() => setDropOpen((o) => !o)}
                    className="flex w-full items-center justify-between rounded-xl border border-ink-900/15 bg-white px-4 py-3 text-left text-sm font-medium text-ink-800 hover:border-accent-400"
                  >
                    <span className="flex items-center gap-2.5">
                      {chosen ? <chosen.icon width={18} height={18} className="text-accent-500" /> : <Icon.Send width={18} height={18} className="text-ink-400" />}
                      {chosen ? chosen.label : "Choose a distribution method"}
                    </span>
                    <Icon.Chevron width={18} height={18} className={`text-ink-400 transition ${dropOpen ? "rotate-90" : ""}`} />
                  </button>
                  {dropOpen && (
                    <div className="mt-1.5 w-full overflow-hidden rounded-xl border border-ink-900/10 bg-white shadow-card animate-fade-up">
                      {METHODS.map((m) => (
                        <button
                          key={m.key}
                          onClick={() => {
                            setMethod(m.key);
                            setDropOpen(false);
                          }}
                          className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent-500/5"
                        >
                          <m.icon width={18} height={18} className="mt-0.5 text-accent-500" />
                          <span>
                            <span className="block text-sm font-semibold text-ink-900">{m.label}</span>
                            <span className="block text-[12px] text-ink-500">{m.desc}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {method === "email" && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg bg-accent-500/5 px-3 py-2 text-[13px] text-ink-600 animate-fade-up">
                    <Icon.Mail width={15} height={15} className="text-accent-500" />
                    Will be sent to <span className="font-semibold text-ink-800">{recipient}</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {!sent && (
          <div className="flex items-center justify-end gap-2 border-t border-ink-900/5 px-6 py-4">
            <button onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-ink-600 hover:bg-ink-900/5">
              Cancel
            </button>
            <button
              onClick={confirm}
              disabled={!method}
              className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${
                auto ? "bg-emerald-600 hover:bg-emerald-700" : "bg-accent-500 hover:bg-accent-600"
              }`}
            >
              {auto ? <Icon.Bolt width={16} height={16} /> : <Icon.Send width={16} height={16} />}
              {auto ? "Send now" : "Distribute 1 Certificate"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, icon: I }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-ink-500">{label}</span>
      <span className="flex items-center gap-1.5 text-right font-medium text-ink-900">
        {I ? <I width={15} height={15} className="text-emerald-600" /> : null}
        {value}
      </span>
    </div>
  );
}

function activeCoverages(cert) {
  const c = cert.coverages;
  const list = [];
  if (c.cgl.enabled) list.push("CGL");
  if (c.auto.enabled) list.push("Auto");
  if (c.umbrella.enabled) list.push("Umbrella");
  if (c.workersComp.enabled) list.push("WC");
  if (c.other.enabled) list.push(c.other.label || "Other");
  return list.join(", ") || "—";
}
