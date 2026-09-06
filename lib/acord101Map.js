import { DATA } from "./acordMap";

// ACORD 101 (2008/01) Additional Remarks Schedule — field coordinate map.
//
// Same contract as lib/acordMap.js: x/y are PDF points on a 612 x 792 page with
// a TOP-LEFT origin, and this file is the only place a position is written down.
//
// Every coordinate here was read off the sample certificate rather than guessed
// — `npx tsx scripts/probe-pdf.mts COI_TRUCK_SOLUTION.PDF 2` prints the boxes
// the issuing agency's own system used, and these are those numbers.

export const PAGE = { w: 612, h: 792 };

export const TEXT = [
  { path: ["acord101", "pageNumber"], x: 537, y: 63, w: 16, size: DATA, align: "center" },
  { path: ["acord101", "pageTotal"], x: 573, y: 63, w: 16, size: DATA, align: "center" },

  { path: ["acord101", "agency"], x: 23, y: 93, w: 280, size: DATA },
  { path: ["acord101", "policyNumber"], x: 23, y: 117, w: 280, size: DATA },
  { path: ["acord101", "carrier"], x: 23, y: 141, w: 230, size: DATA },
  { path: ["acord101", "naic"], x: 260, y: 141, w: 45, size: DATA },

  { path: ["acord101", "namedInsured"], x: 311, y: 93, w: 280, size: DATA },
  { path: ["acord101", "namedInsuredAddress"], x: 311, y: 105, w: 280, h: 36, size: DATA, multi: true, lh: 12 },
  { path: ["acord101", "effectiveDate"], x: 394, y: 141, w: 100, size: DATA },

  { path: ["acord101", "formNumber"], x: 91, y: 181, w: 40, size: DATA },
  { path: ["acord101", "formTitle"], x: 192, y: 181, w: 250, size: DATA },

  // The remarks body. Runs from the rule under FORM TITLE down to the footer:
  // 527 pt at 8.3 leading is 63 lines, far more than a fleet will ever need.
  { path: ["acord101", "remarks"], x: 23, y: 198, w: 566, h: 527, size: DATA, multi: true, lh: 8.3 },
];

/** Matches the TEXT entry above — the assembler wraps to these numbers. */
export const REMARKS = { width: 566, size: DATA, maxLines: 63 };

// The 101 carries no checkboxes.
export const CHECKS = [];
