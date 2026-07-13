// ACORD 25 (2025/12) field coordinate map.
// All coordinates are in PDF points on a 612 x 792 page, TOP-LEFT origin,
// (x, y) = top-left of the text. Derived directly from the real document so
// overlay + generated PDF land exactly on the official form.

export const PAGE = { w: 612, h: 792 };

// Scalar text fields (path into the certificate object).
export const TEXT = [
  { path: ["date"], x: 522, y: 52, w: 68, size: 10, bold: true },

  { path: ["producer", "name"], x: 57, y: 145, w: 246, size: 10, bold: true },
  { path: ["producer", "address"], x: 57, y: 157, w: 246, h: 26, size: 9, multi: true },
  { path: ["producer", "contactName"], x: 356, y: 136, w: 126, size: 9, bold: true },
  { path: ["producer", "phone"], x: 356, y: 148, w: 126, size: 9, bold: true },
  { path: ["producer", "fax"], x: 514, y: 148, w: 74, size: 9, bold: true },
  { path: ["producer", "email"], x: 356, y: 160, w: 132, size: 8.5, bold: true },

  { path: ["certificateNumber"], x: 262, y: 257, w: 96, size: 9, bold: true },
  { path: ["revisionNumber"], x: 512, y: 257, w: 42, size: 9, bold: true, align: "center" },

  { path: ["insured", "name"], x: 57, y: 206, w: 246, size: 10, bold: true },
  { path: ["insured", "address"], x: 57, y: 218, w: 246, h: 26, size: 9, multi: true },

  { path: ["descriptionOfOperations"], x: 24, y: 602, w: 562, h: 54, size: 9, multi: true, lh: 10.6 },

  { path: ["holder", "name"], x: 57, y: 698, w: 246, size: 10, bold: true },
  { path: ["holder", "address"], x: 57, y: 710, w: 246, h: 26, size: 9, multi: true },

  { path: ["authorizedRep"], x: 336, y: 736, w: 200, size: 14, italic: true },

  // ---- Coverage: INSR LTR / policy / eff / exp per row ----
  ...coverageRow(["coverages", "cgl"], 331),
  ...coverageRow(["coverages", "auto"], 413),
  ...coverageRow(["coverages", "umbrella"], 475),
  ...coverageRow(["coverages", "workersComp"], 517),
  ...coverageRow(["coverages", "other"], 556),

  // Other coverage type label (free text, e.g. "Motor Cargo")
  { path: ["coverages", "other", "label"], x: 37, y: 556, w: 120, size: 10, bold: true },

  // ---- Limit values (right column) ----
  ...limit(["coverages", "cgl", "limits", "eachOccurrence"], 331),
  ...limit(["coverages", "cgl", "limits", "damageToRented"], 343),
  ...limit(["coverages", "cgl", "limits", "medExp"], 355),
  ...limit(["coverages", "cgl", "limits", "personalAdvInjury"], 367),
  ...limit(["coverages", "cgl", "limits", "generalAggregate"], 379),
  ...limit(["coverages", "cgl", "limits", "productsCompOp"], 391),

  ...limit(["coverages", "auto", "limits", "combinedSingle"], 413),
  ...limit(["coverages", "auto", "limits", "biPerson"], 425),
  ...limit(["coverages", "auto", "limits", "biAccident"], 437),
  ...limit(["coverages", "auto", "limits", "propertyDamage"], 449),

  ...limit(["coverages", "umbrella", "limits", "eachOccurrence"], 475),
  ...limit(["coverages", "umbrella", "limits", "aggregate"], 487),

  ...limit(["coverages", "workersComp", "limits", "eachAccident"], 523),
  ...limit(["coverages", "workersComp", "limits", "diseaseEmployee"], 535),
  ...limit(["coverages", "workersComp", "limits", "diseasePolicy"], 547),

  // Motor-cargo style free-form limit text
  { path: ["coverages", "other", "limitText"], x: 455, y: 556, w: 133, size: 10, bold: true, align: "right" },
];

function coverageRow(base, y) {
  return [
    { path: [...base, "insrLtr"], x: 20, y, w: 15, size: 10, bold: true, align: "center" },
    { path: [...base, "policyNumber"], x: 214, y, w: 96, size: 10, bold: true },
    { path: [...base, "eff"], x: 330, y, w: 48, size: 9, bold: true, align: "center" },
    { path: [...base, "exp"], x: 378, y, w: 48, size: 9, bold: true, align: "center" },
  ];
}

function limit(path, y) {
  return [{ path, x: 522, y, w: 66, size: 10, bold: true, align: "right" }];
}

// Checkboxes: draw an X at (x, y). `equals` => radio-style (checked when value===equals,
// click sets it); `toggle` => boolean (click flips).
// `gate` = only draw the X when this path is truthy (i.e. the coverage is
// active). Prevents default radio values from showing on disabled coverages.
const CGL = ["coverages", "cgl", "enabled"];
const AUTO = ["coverages", "auto", "enabled"];
const UMB = ["coverages", "umbrella", "enabled"];
const WC = ["coverages", "workersComp", "enabled"];

export const CHECKS = [
  // CGL
  { path: ["coverages", "cgl", "form"], equals: "claimsMade", x: 56, y: 343, gate: CGL },
  { path: ["coverages", "cgl", "form"], equals: "occur", x: 121, y: 343, gate: CGL },
  { path: ["coverages", "cgl", "aggregatePer"], equals: "policy", x: 41, y: 391, gate: CGL },
  { path: ["coverages", "cgl", "aggregatePer"], equals: "project", x: 84, y: 390, gate: CGL },
  { path: ["coverages", "cgl", "aggregatePer"], equals: "loc", x: 127, y: 391, gate: CGL },
  { path: ["coverages", "cgl", "addlInsd"], toggle: true, x: 181, y: 331, gate: CGL },
  { path: ["coverages", "cgl", "subrWvd"], toggle: true, x: 199, y: 331, gate: CGL },

  // Auto
  { path: ["coverages", "auto", "scope"], equals: "any", x: 41, y: 425, gate: AUTO },
  { path: ["coverages", "auto", "scope"], equals: "owned", x: 41, y: 437, gate: AUTO },
  { path: ["coverages", "auto", "scope"], equals: "scheduled", x: 108, y: 437, gate: AUTO },
  { path: ["coverages", "auto", "scope"], equals: "hired", x: 41, y: 449, gate: AUTO },
  { path: ["coverages", "auto", "scope"], equals: "nonOwned", x: 108, y: 449, gate: AUTO },
  { path: ["coverages", "auto", "addlInsd"], toggle: true, x: 181, y: 413, gate: AUTO },
  { path: ["coverages", "auto", "subrWvd"], toggle: true, x: 199, y: 413, gate: AUTO },

  // Umbrella / Excess
  { path: ["coverages", "umbrella", "enabled"], toggle: true, x: 41, y: 474 },
  { path: ["coverages", "umbrella", "form"], equals: "occur", x: 121, y: 475, gate: UMB },
  { path: ["coverages", "umbrella", "form"], equals: "claimsMade", x: 121, y: 487, gate: UMB },

  // Workers comp
  { path: ["coverages", "workersComp", "perStatute"], toggle: true, x: 429, y: 508, gate: WC },
];

// Text alignment / anchoring helpers shared by overlay + pdf filler.
export function isChecked(value, chk) {
  return chk.toggle ? !!value : value === chk.equals;
}
