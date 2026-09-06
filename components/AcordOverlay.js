"use client";

// Renders the certificate as the REAL ACORD 25 template (blank PNG background)
// with editable fields positioned at exact PDF coordinates. This guarantees the
// on-screen document is 100% identical to COI TRUCK SOLUTION.PDF.

import { PAGE, TEXT, CHECKS, isChecked, DATA } from "@/lib/acordMap";
import { TEXT as TEXT_101 } from "@/lib/acord101Map";
import { getPath, setPath } from "@/lib/path";

/**
 * The two form pages this component can draw. Which map is in play decides the
 * fields AND the background, so they can never be mismatched.
 */
const SHEETS = {
  acord25: { text: TEXT, checks: CHECKS, background: "/acord25-blank.png", insurers: true },
  acord101: { text: TEXT_101, checks: [], background: "/acord101-blank.png", insurers: false },
};

const INK = "#000000"; // matches the black the real form prints data in
// Fine vertical nudge (points) so HTML text baselines sit on the form lines.
const TWEAK_Y = -1.2;

const INSURER_ROWS = ["A", "B", "C", "D", "E", "F"].map((letter, i) => ({
  letter,
  y: 184 + i * 12,
}));

export default function AcordOverlay({ cert, editing, onChange, width = 900, sheet = "acord25" }) {
  const { text: FIELDS, checks: BOXES, background, insurers: showInsurers } = SHEETS[sheet];
  const S = width / PAGE.w;
  const height = width * (PAGE.h / PAGE.w);

  const insurerByLetter = Object.fromEntries((cert.insurers || []).map((it) => [it.letter, it]));

  function updateInsurer(letter, field, value) {
    const existing = cert.insurers || [];
    const idx = existing.findIndex((it) => it.letter === letter);
    const next =
      idx >= 0
        ? existing.map((it) => (it.letter === letter ? { ...it, [field]: value } : it))
        : [...existing, { letter, name: "", naic: "", [field]: value }];
    onChange({ ...cert, insurers: next });
  }

  function textStyle(f) {
    const fs = f.size * S;
    const lh = (f.multi ? f.lh || f.size * 1.18 : f.size * 1.32) * S;
    return {
      position: "absolute",
      left: f.x * S,
      top: (f.y + TWEAK_Y) * S,
      width: f.w * S,
      height: f.multi ? f.h * S : lh,
      fontSize: fs,
      lineHeight: `${lh}px`,
      fontFamily: "Arial, Helvetica, sans-serif",
      fontWeight: f.bold ? 700 : 400,
      fontStyle: f.italic ? "italic" : "normal",
      textAlign: f.align || "left",
      color: INK,
      background: "transparent",
      border: "none",
      outline: "none",
      padding: 0,
      margin: 0,
      resize: "none",
      overflow: "hidden",
      whiteSpace: f.multi ? "pre-wrap" : "nowrap",
    };
  }

  const editRing = editing
    ? { boxShadow: "inset 0 0 0 1px rgba(242,101,34,0.35)", background: "rgba(255,247,240,0.6)", borderRadius: 2 }
    : null;

  return (
    <div
      className="relative select-none"
      style={{ width, height, backgroundImage: `url(${background})`, backgroundSize: "100% 100%" }}
    >
      {/* Scalar text fields */}
      {FIELDS.map((f, i) => {
        const value = getPath(cert, f.path) ?? "";
        const style = { ...textStyle(f), ...(editing ? editRing : null) };
        const common = {
          // The field's map path, so anything outside this component can
          // address a specific box — a browser test asserting what landed in
          // the holder block should not have to guess by input order.
          "data-field": f.path.join("."),
          value,
          readOnly: !editing,
          onChange: (e) => onChange(setPath(cert, f.path, e.target.value)),
          style,
          spellCheck: false,
        };
        return f.multi ? (
          <textarea key={i} {...common} />
        ) : (
          <input key={i} {...common} />
        );
      })}

      {/* Insurer rows A–F (ACORD 25 only) */}
      {showInsurers && INSURER_ROWS.map(({ letter, y }) => {
        const rec = insurerByLetter[letter] || {};
        const base = {
          position: "absolute",
          top: (y + TWEAK_Y) * S,
          height: DATA * 1.32 * S,
          fontSize: DATA * S,
          lineHeight: `${DATA * 1.32 * S}px`,
          fontFamily: "Arial, Helvetica, sans-serif",
          fontWeight: 400,
          color: INK,
          background: "transparent",
          border: "none",
          outline: "none",
          padding: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
        };
        return (
          <div key={letter}>
            <input
              value={rec.name || ""}
              readOnly={!editing}
              onChange={(e) => updateInsurer(letter, "name", e.target.value)}
              spellCheck={false}
              style={{ ...base, left: 352 * S, width: 182 * S, ...(editing ? editRing : null) }}
            />
            <input
              value={rec.naic || ""}
              readOnly={!editing}
              onChange={(e) => updateInsurer(letter, "naic", e.target.value)}
              spellCheck={false}
              style={{ ...base, left: 540 * S, width: 50 * S, ...(editing ? editRing : null) }}
            />
          </div>
        );
      })}

      {/* Checkboxes (X marks) */}
      {BOXES.map((chk, i) => {
        const value = getPath(cert, chk.path);
        const gateOk = !chk.gate || !!getPath(cert, chk.gate);
        const on = isChecked(value, chk) && gateOk;
        function toggle() {
          if (!editing) return;
          let next = chk.toggle
            ? setPath(cert, chk.path, !value)
            : setPath(cert, chk.path, isChecked(value, chk) ? "" : chk.equals);
          // Turning a gated control on activates its coverage row.
          if (chk.gate && !getPath(next, chk.gate)) next = setPath(next, chk.gate, true);
          onChange(next);
        }
        return (
          <button
            key={i}
            type="button"
            onClick={toggle}
            tabIndex={editing ? 0 : -1}
            style={{
              position: "absolute",
              left: (chk.x - 1) * S,
              top: (chk.y - 1.5) * S,
              width: 11 * S,
              height: 11 * S,
              fontSize: 11 * S,
              lineHeight: `${11 * S}px`,
              fontFamily: "Arial, Helvetica, sans-serif",
              fontWeight: 700,
              color: INK,
              textAlign: "center",
              background: editing ? "rgba(255,247,240,0.7)" : "transparent",
              border: "none",
              padding: 0,
              cursor: editing ? "pointer" : "default",
              pointerEvents: editing ? "auto" : "none",
              borderRadius: 2,
            }}
          >
            {on ? "X" : ""}
          </button>
        );
      })}
    </div>
  );
}
