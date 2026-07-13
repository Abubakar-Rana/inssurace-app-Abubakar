"use client";

// Faithful-but-clean, fully editable ACORD 25 (2025/12) representation.
// `editing` toggles read-only vs editable. All edits flow up via onChange(nextCert).

function setIn(obj, path, value) {
  if (path.length === 0) return value;
  const [k, ...rest] = path;
  const src = obj == null ? {} : obj;
  const clone = Array.isArray(src) ? [...src] : { ...src };
  clone[k] = setIn(src[k], rest, value);
  return clone;
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const GRID = "32px minmax(0,1fr) 26px 26px 112px 66px 66px 226px";

function Txt({ cert, path, onChange, editing, placeholder, className = "", right }) {
  const value = path.reduce((a, k) => (a == null ? "" : a[k]), cert) ?? "";
  return (
    <input
      className={`acord-input ${right ? "text-right" : ""} ${className}`}
      value={value}
      readOnly={!editing}
      placeholder={editing ? placeholder || "" : ""}
      onChange={(e) => onChange(setIn(cert, path, e.target.value))}
    />
  );
}

function Chk({ checked, onToggle, editing, label, labelClass = "" }) {
  return (
    <button
      type="button"
      disabled={!editing}
      onClick={onToggle}
      className={`inline-flex items-center gap-1 text-left ${editing ? "cursor-pointer" : "cursor-default"}`}
    >
      <span
        className={`inline-flex h-[13px] w-[13px] flex-none items-center justify-center border border-ink-600 text-[10px] font-bold leading-none ${
          checked ? "bg-ink-800 text-white" : "bg-white text-transparent"
        }`}
      >
        ✕
      </span>
      {label ? <span className={`text-[8.5px] leading-tight text-ink-700 ${labelClass}`}>{label}</span> : null}
    </button>
  );
}

function LimitLine({ label, sub, cert, path, onChange, editing, last }) {
  return (
    <div className={`flex items-center justify-between gap-1 px-1.5 py-[3px] ${last ? "" : "border-b border-ink-900/10"}`}>
      <span className="text-[8px] font-semibold uppercase leading-tight tracking-tight text-ink-700">
        {label}
        {sub ? <span className="font-normal normal-case text-ink-400"> {sub}</span> : null}
      </span>
      <span className="flex flex-none items-center gap-0.5">
        <span className="text-[9px] text-ink-400">$</span>
        <Txt cert={cert} path={path} onChange={onChange} editing={editing} right className="w-[70px] font-semibold" />
      </span>
    </div>
  );
}

function Cell({ children, className = "" }) {
  return <div className={`acord-cell p-1 ${className}`}>{children}</div>;
}

function ColLabel({ children }) {
  return <span className="text-[7.5px] font-bold uppercase leading-tight tracking-tight text-ink-500">{children}</span>;
}

export default function AcordForm({ cert, editing, onChange }) {
  const c = cert;
  const insurerByLetter = Object.fromEntries((c.insurers || []).map((i) => [i.letter, i]));

  function updateInsurer(letter, field, value) {
    const existing = c.insurers || [];
    const idx = existing.findIndex((i) => i.letter === letter);
    let next;
    if (idx >= 0) {
      next = existing.map((i) => (i.letter === letter ? { ...i, [field]: value } : i));
    } else {
      next = [...existing, { letter, name: "", naic: "", [field]: value }];
    }
    onChange({ ...c, insurers: next });
  }

  const cov = c.coverages;

  return (
    <div className={`print-area ${editing ? "acord-editing" : ""}`}>
      <div className="mx-auto w-[848px] bg-white text-ink-900" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
        {/* Title */}
        <div className="grid grid-cols-[1fr_150px] border border-ink-900/70">
          <div className="flex items-center justify-center px-2 py-1.5">
            <h2 className="text-center text-[14px] font-bold tracking-tight">CERTIFICATE OF LIABILITY INSURANCE</h2>
          </div>
          <div className="acord-cell flex flex-col justify-center px-2 py-1">
            <ColLabel>Date (MM/DD/YYYY)</ColLabel>
            <Txt cert={c} path={["date"]} onChange={onChange} editing={editing} className="font-semibold" />
          </div>
        </div>

        {/* Disclaimer */}
        <div className="border-x border-b border-ink-900/70 px-2 py-1.5 text-[7.5px] leading-[1.35] text-ink-600">
          THIS CERTIFICATE IS ISSUED AS A MATTER OF INFORMATION ONLY AND CONFERS NO RIGHTS UPON THE CERTIFICATE HOLDER. THIS
          CERTIFICATE DOES NOT AFFIRMATIVELY OR NEGATIVELY AMEND, EXTEND OR ALTER THE COVERAGE AFFORDED BY THE POLICIES BELOW.
          THIS CERTIFICATE OF INSURANCE DOES NOT CONSTITUTE A CONTRACT BETWEEN THE ISSUING INSURER(S), AUTHORIZED REPRESENTATIVE
          OR PRODUCER, AND THE CERTIFICATE HOLDER.
          <span className="mt-1 block font-bold text-ink-700">
            IMPORTANT: If the certificate holder is an ADDITIONAL INSURED, the policy(ies) must have ADDITIONAL INSURED provisions or
            be endorsed. If SUBROGATION IS WAIVED, subject to the terms and conditions of the policy, certain policies may require an
            endorsement. A statement on this certificate does not confer rights to the certificate holder in lieu of such
            endorsement(s).
          </span>
        </div>

        {/* Producer / Insured / Insurers */}
        <div className="grid grid-cols-2 border-x border-ink-900/70">
          {/* Left: producer + insured */}
          <div className="border-r border-ink-900/70">
            <div className="acord-cell px-2 py-1">
              <ColLabel>Producer</ColLabel>
              <div className="mt-0.5">
                <Txt cert={c} path={["producer", "name"]} onChange={onChange} editing={editing} className="font-semibold" placeholder="Agency name" />
                <AddressArea cert={c} path={["producer", "address"]} onChange={onChange} editing={editing} rows={2} />
              </div>
            </div>
            <div className="acord-cell px-2 py-1">
              <ColLabel>Insured</ColLabel>
              <div className="mt-0.5">
                <Txt cert={c} path={["insured", "name"]} onChange={onChange} editing={editing} className="font-semibold" placeholder="Named insured" />
                <AddressArea cert={c} path={["insured", "address"]} onChange={onChange} editing={editing} rows={3} />
              </div>
            </div>
          </div>

          {/* Right: contact + insurers */}
          <div>
            <div className="grid grid-cols-2">
              <Cell>
                <ColLabel>Contact Name</ColLabel>
                <Txt cert={c} path={["producer", "contactName"]} onChange={onChange} editing={editing} />
              </Cell>
              <Cell className="grid grid-cols-2 gap-x-1">
                <div>
                  <ColLabel>Phone (A/C, No, Ext)</ColLabel>
                  <Txt cert={c} path={["producer", "phone"]} onChange={onChange} editing={editing} />
                </div>
                <div>
                  <ColLabel>Fax (A/C, No)</ColLabel>
                  <Txt cert={c} path={["producer", "fax"]} onChange={onChange} editing={editing} />
                </div>
              </Cell>
              <Cell className="col-span-2">
                <ColLabel>E-Mail Address</ColLabel>
                <Txt cert={c} path={["producer", "email"]} onChange={onChange} editing={editing} />
              </Cell>
            </div>
            <div className="acord-cell grid grid-cols-[1fr_58px] bg-ink-900/[0.03]">
              <span className="px-1 py-0.5 text-[7.5px] font-bold uppercase tracking-tight text-ink-600">
                Insurer(s) Affording Coverage
              </span>
              <span className="border-l border-ink-900/10 px-1 py-0.5 text-[7.5px] font-bold uppercase tracking-tight text-ink-600">
                NAIC #
              </span>
            </div>
            {LETTERS.map((L) => (
              <div key={L} className="acord-cell grid grid-cols-[58px_1fr_58px] items-center">
                <span className="border-r border-ink-900/10 px-1 text-[8.5px] font-bold text-ink-700">INSURER {L} :</span>
                <input
                  className="acord-input px-1 py-0.5"
                  value={insurerByLetter[L]?.name || ""}
                  readOnly={!editing}
                  onChange={(e) => updateInsurer(L, "name", e.target.value)}
                />
                <input
                  className="acord-input border-l border-ink-900/10 px-1 py-0.5"
                  value={insurerByLetter[L]?.naic || ""}
                  readOnly={!editing}
                  onChange={(e) => updateInsurer(L, "naic", e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Coverages header bar */}
        <div className="grid grid-cols-[1fr_1fr_1fr] border-x border-ink-900/70 bg-ink-900/[0.04]">
          <div className="acord-cell px-2 py-1 text-[10px] font-bold tracking-tight">COVERAGES</div>
          <div className="acord-cell px-2 py-1 text-[8.5px] font-semibold">
            CERTIFICATE NUMBER:{" "}
            <Txt cert={c} path={["certificateNumber"]} onChange={onChange} editing={editing} className="inline-block w-28 font-bold" />
          </div>
          <div className="acord-cell px-2 py-1 text-[8.5px] font-semibold">
            REVISION NUMBER:{" "}
            <Txt cert={c} path={["revisionNumber"]} onChange={onChange} editing={editing} className="inline-block w-16 font-bold" />
          </div>
        </div>
        <div className="border-x border-b border-ink-900/70 px-2 py-1 text-[7px] leading-[1.3] text-ink-500">
          THIS IS TO CERTIFY THAT THE POLICIES OF INSURANCE LISTED BELOW HAVE BEEN ISSUED TO THE INSURED NAMED ABOVE FOR THE POLICY
          PERIOD INDICATED. NOTWITHSTANDING ANY REQUIREMENT, TERM OR CONDITION OF ANY CONTRACT OR OTHER DOCUMENT WITH RESPECT TO
          WHICH THIS CERTIFICATE MAY BE ISSUED OR MAY PERTAIN, THE INSURANCE AFFORDED BY THE POLICIES DESCRIBED HEREIN IS SUBJECT TO
          ALL THE TERMS, EXCLUSIONS AND CONDITIONS OF SUCH POLICIES. LIMITS SHOWN MAY HAVE BEEN REDUCED BY PAID CLAIMS.
        </div>

        {/* Coverage table header */}
        <div className="grid border-x border-ink-900/70 bg-ink-900/[0.04] text-center" style={{ gridTemplateColumns: GRID }}>
          <HeadCell>INSR LTR</HeadCell>
          <HeadCell align="left">TYPE OF INSURANCE</HeadCell>
          <HeadCell>ADDL INSD</HeadCell>
          <HeadCell>SUBR WVD</HeadCell>
          <HeadCell>POLICY NUMBER</HeadCell>
          <HeadCell>POLICY EFF</HeadCell>
          <HeadCell>POLICY EXP</HeadCell>
          <HeadCell align="left">LIMITS</HeadCell>
        </div>

        {/* CGL */}
        <CoverageRow
          cert={c}
          onChange={onChange}
          editing={editing}
          insrLtr={cov.cgl.insrLtr}
          onLtr={(v) => onChange(setIn(c, ["coverages", "cgl", "insrLtr"], v))}
          addl={cov.cgl.addlInsd}
          onAddl={() => onChange(setIn(c, ["coverages", "cgl", "addlInsd"], !cov.cgl.addlInsd))}
          subr={cov.cgl.subrWvd}
          onSubr={() => onChange(setIn(c, ["coverages", "cgl", "subrWvd"], !cov.cgl.subrWvd))}
          policyPath={["coverages", "cgl", "policyNumber"]}
          effPath={["coverages", "cgl", "eff"]}
          expPath={["coverages", "cgl", "exp"]}
          dim={!cov.cgl.enabled}
          type={
            <div className="space-y-1">
              <p className="text-[9px] font-bold uppercase tracking-tight text-ink-800">Commercial General Liability</p>
              <div className="flex items-center gap-3">
                <Chk editing={editing} checked={cov.cgl.form === "claimsMade"} onToggle={() => onChange(setIn(c, ["coverages", "cgl", "form"], "claimsMade"))} label="CLAIMS-MADE" />
                <Chk editing={editing} checked={cov.cgl.form === "occur"} onToggle={() => onChange(setIn(c, ["coverages", "cgl", "form"], "occur"))} label="OCCUR" />
              </div>
              <p className="pt-0.5 text-[7.5px] font-bold uppercase text-ink-500">Gen'l aggregate limit applies per:</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Chk editing={editing} checked={cov.cgl.aggregatePer === "policy"} onToggle={() => onChange(setIn(c, ["coverages", "cgl", "aggregatePer"], "policy"))} label="POLICY" />
                <Chk editing={editing} checked={cov.cgl.aggregatePer === "project"} onToggle={() => onChange(setIn(c, ["coverages", "cgl", "aggregatePer"], "project"))} label="PROJECT" />
                <Chk editing={editing} checked={cov.cgl.aggregatePer === "loc"} onToggle={() => onChange(setIn(c, ["coverages", "cgl", "aggregatePer"], "loc"))} label="LOC" />
              </div>
            </div>
          }
          limits={
            <>
              <LimitLine label="Each Occurrence" cert={c} path={["coverages", "cgl", "limits", "eachOccurrence"]} onChange={onChange} editing={editing} />
              <LimitLine label="Damage to Rented" sub="Premises (Ea occ.)" cert={c} path={["coverages", "cgl", "limits", "damageToRented"]} onChange={onChange} editing={editing} />
              <LimitLine label="Med Exp" sub="(Any one person)" cert={c} path={["coverages", "cgl", "limits", "medExp"]} onChange={onChange} editing={editing} />
              <LimitLine label="Personal & Adv Injury" cert={c} path={["coverages", "cgl", "limits", "personalAdvInjury"]} onChange={onChange} editing={editing} />
              <LimitLine label="General Aggregate" cert={c} path={["coverages", "cgl", "limits", "generalAggregate"]} onChange={onChange} editing={editing} />
              <LimitLine label="Products - Comp/Op Agg" cert={c} path={["coverages", "cgl", "limits", "productsCompOp"]} onChange={onChange} editing={editing} last />
            </>
          }
        />

        {/* Auto */}
        <CoverageRow
          cert={c}
          onChange={onChange}
          editing={editing}
          insrLtr={cov.auto.insrLtr}
          onLtr={(v) => onChange(setIn(c, ["coverages", "auto", "insrLtr"], v))}
          addl={cov.auto.addlInsd}
          onAddl={() => onChange(setIn(c, ["coverages", "auto", "addlInsd"], !cov.auto.addlInsd))}
          subr={cov.auto.subrWvd}
          onSubr={() => onChange(setIn(c, ["coverages", "auto", "subrWvd"], !cov.auto.subrWvd))}
          policyPath={["coverages", "auto", "policyNumber"]}
          effPath={["coverages", "auto", "eff"]}
          expPath={["coverages", "auto", "exp"]}
          dim={!cov.auto.enabled}
          type={
            <div className="space-y-1">
              <p className="text-[9px] font-bold uppercase tracking-tight text-ink-800">Automobile Liability</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                <Chk editing={editing} checked={cov.auto.scope === "any"} onToggle={() => onChange(setIn(c, ["coverages", "auto", "scope"], "any"))} label="ANY AUTO" />
                <Chk editing={editing} checked={cov.auto.scope === "scheduled"} onToggle={() => onChange(setIn(c, ["coverages", "auto", "scope"], "scheduled"))} label="SCHEDULED AUTOS" />
                <Chk editing={editing} checked={cov.auto.scope === "owned"} onToggle={() => onChange(setIn(c, ["coverages", "auto", "scope"], "owned"))} label="OWNED AUTOS ONLY" />
                <Chk editing={editing} checked={cov.auto.scope === "hired"} onToggle={() => onChange(setIn(c, ["coverages", "auto", "scope"], "hired"))} label="HIRED AUTOS ONLY" />
                <Chk editing={editing} checked={cov.auto.scope === "nonOwned"} onToggle={() => onChange(setIn(c, ["coverages", "auto", "scope"], "nonOwned"))} label="NON-OWNED AUTOS" />
              </div>
            </div>
          }
          limits={
            <>
              <LimitLine label="Combined Single Limit" sub="(Ea accident)" cert={c} path={["coverages", "auto", "limits", "combinedSingle"]} onChange={onChange} editing={editing} />
              <LimitLine label="Bodily Injury" sub="(Per person)" cert={c} path={["coverages", "auto", "limits", "biPerson"]} onChange={onChange} editing={editing} />
              <LimitLine label="Bodily Injury" sub="(Per accident)" cert={c} path={["coverages", "auto", "limits", "biAccident"]} onChange={onChange} editing={editing} />
              <LimitLine label="Property Damage" sub="(Per accident)" cert={c} path={["coverages", "auto", "limits", "propertyDamage"]} onChange={onChange} editing={editing} last />
            </>
          }
        />

        {/* Umbrella */}
        <CoverageRow
          cert={c}
          onChange={onChange}
          editing={editing}
          insrLtr={cov.umbrella.insrLtr}
          onLtr={(v) => onChange(setIn(c, ["coverages", "umbrella", "insrLtr"], v))}
          policyPath={["coverages", "umbrella", "policyNumber"]}
          effPath={["coverages", "umbrella", "eff"]}
          expPath={["coverages", "umbrella", "exp"]}
          dim={!cov.umbrella.enabled}
          type={
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <span className="text-[9px] font-bold uppercase text-ink-800">Umbrella Liab</span>
                <Chk editing={editing} checked={cov.umbrella.form === "occur"} onToggle={() => onChange(setIn(c, ["coverages", "umbrella", "form"], "occur"))} label="OCCUR" />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[9px] font-bold uppercase text-ink-800">Excess Liab</span>
                <Chk editing={editing} checked={cov.umbrella.form === "claimsMade"} onToggle={() => onChange(setIn(c, ["coverages", "umbrella", "form"], "claimsMade"))} label="CLAIMS-MADE" />
              </div>
            </div>
          }
          limits={
            <>
              <LimitLine label="Each Occurrence" cert={c} path={["coverages", "umbrella", "limits", "eachOccurrence"]} onChange={onChange} editing={editing} />
              <LimitLine label="Aggregate" cert={c} path={["coverages", "umbrella", "limits", "aggregate"]} onChange={onChange} editing={editing} last />
            </>
          }
        />

        {/* Workers Comp */}
        <CoverageRow
          cert={c}
          onChange={onChange}
          editing={editing}
          insrLtr={cov.workersComp.insrLtr}
          onLtr={(v) => onChange(setIn(c, ["coverages", "workersComp", "insrLtr"], v))}
          policyPath={["coverages", "workersComp", "policyNumber"]}
          effPath={["coverages", "workersComp", "eff"]}
          expPath={["coverages", "workersComp", "exp"]}
          dim={!cov.workersComp.enabled}
          type={
            <div className="space-y-1">
              <p className="text-[9px] font-bold uppercase leading-tight text-ink-800">Workers Compensation and Employers' Liability</p>
              <div className="flex items-center gap-2">
                <Chk editing={editing} checked={cov.workersComp.perStatute} onToggle={() => onChange(setIn(c, ["coverages", "workersComp", "perStatute"], !cov.workersComp.perStatute))} label="PER STATUTE" />
                <span className="text-[8px] uppercase text-ink-400">Other</span>
              </div>
            </div>
          }
          limits={
            <>
              <LimitLine label="E.L. Each Accident" cert={c} path={["coverages", "workersComp", "limits", "eachAccident"]} onChange={onChange} editing={editing} />
              <LimitLine label="E.L. Disease - Ea Employee" cert={c} path={["coverages", "workersComp", "limits", "diseaseEmployee"]} onChange={onChange} editing={editing} />
              <LimitLine label="E.L. Disease - Policy Limit" cert={c} path={["coverages", "workersComp", "limits", "diseasePolicy"]} onChange={onChange} editing={editing} last />
            </>
          }
        />

        {/* Other */}
        <CoverageRow
          cert={c}
          onChange={onChange}
          editing={editing}
          insrLtr={cov.other.insrLtr}
          onLtr={(v) => onChange(setIn(c, ["coverages", "other", "insrLtr"], v))}
          policyPath={["coverages", "other", "policyNumber"]}
          effPath={["coverages", "other", "eff"]}
          expPath={["coverages", "other", "exp"]}
          dim={!cov.other.enabled}
          type={
            <div className="space-y-1">
              <Txt cert={c} path={["coverages", "other", "label"]} onChange={onChange} editing={editing} placeholder="Other coverage" className="text-[9px] font-bold uppercase text-ink-800" />
            </div>
          }
          limits={
            <div className="flex items-center justify-end px-1.5 py-2">
              <Txt cert={c} path={["coverages", "other", "limitText"]} onChange={onChange} editing={editing} right className="font-semibold" placeholder="Limit" />
            </div>
          }
        />

        {/* Description of operations */}
        <div className="border-x border-b border-ink-900/70 px-2 py-1">
          <ColLabel>Description of Operations / Locations / Vehicles (ACORD 101 may be attached if more space is required)</ColLabel>
          <AddressArea cert={c} path={["descriptionOfOperations"]} onChange={onChange} editing={editing} rows={4} className="mt-1 text-[10px]" />
        </div>

        {/* Holder + cancellation */}
        <div className="grid grid-cols-2 border-x border-b border-ink-900/70">
          <div className="border-r border-ink-900/70 px-2 py-1">
            <ColLabel>Certificate Holder</ColLabel>
            <div className="mt-0.5">
              <Txt cert={c} path={["holder", "name"]} onChange={onChange} editing={editing} className="font-semibold" placeholder="Holder name" />
              <AddressArea cert={c} path={["holder", "address"]} onChange={onChange} editing={editing} rows={3} />
            </div>
          </div>
          <div className="px-2 py-1">
            <ColLabel>Cancellation</ColLabel>
            <p className="mt-1 text-[8px] leading-[1.4] text-ink-600">
              SHOULD ANY OF THE ABOVE DESCRIBED POLICIES BE CANCELLED BEFORE THE EXPIRATION DATE THEREOF, NOTICE WILL BE DELIVERED IN
              ACCORDANCE WITH THE POLICY PROVISIONS.
            </p>
            <div className="mt-3 border-t border-ink-900/30 pt-1">
              <ColLabel>Authorized Representative</ColLabel>
              <div className="flex items-end justify-between">
                <span className="mt-1 font-[cursive] text-[15px] italic text-ink-800">{c.authorizedRep}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-x border-b border-ink-900/70 px-2 py-1 text-[7.5px] text-ink-400">
          <span className="font-semibold text-ink-500">ACORD 25 (2025/12)</span>
          <span>© 1988-2025 ACORD CORPORATION. All rights reserved.</span>
        </div>
      </div>
    </div>
  );
}

function HeadCell({ children, align = "center" }) {
  return (
    <div className={`acord-cell px-1 py-1 text-[${align === "left" ? "8" : "7.5"}px] font-bold uppercase tracking-tight text-ink-600 ${align === "left" ? "text-left" : "text-center"}`}>
      <span className="text-[7.5px] font-bold uppercase leading-tight text-ink-600">{children}</span>
    </div>
  );
}

function CoverageRow({ cert, editing, onChange, insrLtr, onLtr, addl, onAddl, subr, onSubr, policyPath, effPath, expPath, type, limits, dim }) {
  return (
    <div className={`grid border-x border-ink-900/70 ${dim ? "opacity-45" : ""}`} style={{ gridTemplateColumns: GRID }}>
      <div className="acord-cell flex items-start justify-center p-1">
        <input
          className="acord-input w-6 text-center font-bold"
          value={insrLtr || ""}
          readOnly={!editing}
          maxLength={1}
          onChange={(e) => onLtr(e.target.value.toUpperCase())}
        />
      </div>
      <div className="acord-cell p-1.5">{type}</div>
      <div className="acord-cell flex items-start justify-center p-1 pt-2">
        {onAddl ? <Chk editing={editing} checked={!!addl} onToggle={onAddl} /> : <span className="text-[9px] text-ink-300">—</span>}
      </div>
      <div className="acord-cell flex items-start justify-center p-1 pt-2">
        {onSubr ? <Chk editing={editing} checked={!!subr} onToggle={onSubr} /> : <span className="text-[9px] text-ink-300">—</span>}
      </div>
      <div className="acord-cell p-1">
        <input
          className="acord-input font-semibold"
          value={policyPath.reduce((a, k) => (a == null ? "" : a[k]), cert) ?? ""}
          readOnly={!editing}
          onChange={(e) => onChange(setIn(cert, policyPath, e.target.value))}
        />
      </div>
      <div className="acord-cell p-1">
        <input
          className="acord-input text-center"
          style={{ fontSize: "10px" }}
          value={effPath.reduce((a, k) => (a == null ? "" : a[k]), cert) ?? ""}
          readOnly={!editing}
          onChange={(e) => onChange(setIn(cert, effPath, e.target.value))}
        />
      </div>
      <div className="acord-cell p-1">
        <input
          className="acord-input text-center"
          style={{ fontSize: "10px" }}
          value={expPath.reduce((a, k) => (a == null ? "" : a[k]), cert) ?? ""}
          readOnly={!editing}
          onChange={(e) => onChange(setIn(cert, expPath, e.target.value))}
        />
      </div>
      <div className="acord-cell p-0">{limits}</div>
    </div>
  );
}

function AddressArea({ cert, path, onChange, editing, rows = 2, className = "" }) {
  const value = path.reduce((a, k) => (a == null ? "" : a[k]), cert) ?? "";
  return (
    <textarea
      className={`acord-input block w-full resize-none leading-tight ${className}`}
      rows={rows}
      value={value}
      readOnly={!editing}
      onChange={(e) => onChange(setIn(cert, path, e.target.value))}
    />
  );
}
