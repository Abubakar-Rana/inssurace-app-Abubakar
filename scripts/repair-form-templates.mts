/**
 * Restores rules and captions that were erased from the blank ACORD templates.
 *
 * WHY THIS EXISTS
 *
 * Both blanks were produced by painting white rectangles over a filled form to
 * strip its data. Wherever one of those rectangles crossed a printed rule, it
 * erased the rule as well as the data, and where one clipped a caption it took
 * half the letterforms with it. Certificates then looked like text floating in
 * open space.
 *
 * That is a defect in the ASSET, not in either renderer. Neither
 * `lib/acordPdf.js` nor `components/AcordOverlay.js` draws a background, so no
 * change to how text is stamped can put back a line that is not in the file —
 * which is also why converting the form to HTML and back would not have helped.
 *
 * EVERY NUMBER BELOW WAS MEASURED. Rasterising a page at 8 px/pt and scanning
 * for runs of dark pixels reports each rule's true extent and weight; a rule
 * that stops mid-cell is damage, and the gap is what gets redrawn. The `expect`
 * field records what the scan found, so a later reader can re-run
 * `scripts/scan-rules.mts` and check the claim rather than trust it.
 *
 *   npm run repair:templates            # write the repairs
 *   npm run repair:templates -- --check # report only, change nothing
 *
 * Re-running is safe: each repair reads from the untouched `.damaged.pdf` copy,
 * so the script is idempotent rather than cumulative.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as mupdf from "mupdf";

/** A rule to restore. `t` is stroke weight in points, measured off an intact stretch. */
type Seg =
  | { kind: "h"; y: number; x0: number; x1: number; t: number; why: string; expect: string }
  | { kind: "v"; x: number; y0: number; y1: number; t: number; why: string; expect: string };

/**
 * Debris the redaction left behind: a fragment of a rule whose rest is gone,
 * attached to nothing. Painting it out is the repair — there is no line here to
 * complete, and a stub rising off a border reads as a printing fault.
 */
interface Erasure {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  why: string;
}

/** A caption whose glyphs were clipped, which a line cannot bring back. */
interface TextRepair {
  text: string;
  x: number;
  /** Top of the cap, taken from the surviving glyph tops. */
  yTop: number;
  size: number;
  /** Cap height of the face, to put the baseline under that measured top. */
  capHeight: number;
  /** Blanked first, so no half-glyph shows through the redraw. */
  clear: { x0: number; y0: number; x1: number; y1: number };
  why: string;
}

interface Template {
  name: string;
  src: string;
  png: string;
  /** Preserves each PNG asset's existing pixel size. */
  pngWidth: number;
  repairs: Seg[];
  text: TextRepair[];
  erase: Erasure[];
}

// ---------------------------------------------------------------- ACORD 25

/**
 * The form's inner rules profile at 5 px of dark at 16 px/pt — 0.3125pt.
 * Drawing the repairs heavier than that made them visibly bolder than the rules
 * they continued, which reads as the form being smudged exactly where the data
 * sits. The borders are ~1pt, but nothing here repairs a border.
 */
const R25 = 0.3125;

const ACORD25: Template = {
  name: "ACORD 25",
  src: "public/acord25-blank.pdf",
  png: "public/acord25-blank.png",
  pngWidth: 1592,
  repairs: [
    // ---- CONTACT / PHONE / FAX / E-MAIL block (x 306 -> 595) ----
    // Each row closes with a rule running the full width of the block. The scan
    // finds them stopping just past their caption.
    { kind: "h", y: 146.25, x0: 354, x1: 483, t: R25, why: "CONTACT NAME underline", expect: "306->354  483->595" },
    { kind: "h", y: 158.25, x0: 354, x1: 483, t: R25, why: "PHONE underline", expect: "306->354  483->512" },
    { kind: "h", y: 158.25, x0: 512, x1: 595, t: R25, why: "FAX underline", expect: "306->354  483->512" },
    { kind: "h", y: 170.25, x0: 354, x1: 485, t: R25, why: "E-MAIL ADDRESS underline", expect: "306->354  485->595" },

    // ---- INSURER A / B row separators ----
    // Rows C..F scan as a clean 306->595. A and B stop at 350.
    { kind: "h", y: 194.25, x0: 350, x1: 595, t: R25, why: "INSURER A/B separator", expect: "18->350" },
    { kind: "h", y: 206.25, x0: 350, x1: 595, t: R25, why: "INSURER B/C separator", expect: "306->350" },

    // ---- NAIC column divider ----
    // Runs 170->255 undamaged; the scan finds 170->184 and 208->255, i.e. it is
    // missing across exactly the two rows repaired above.
    { kind: "v", x: 539.9, y0: 184, y1: 208, t: R25, why: "NAIC column divider", expect: "170->184  208->255" },

    // ---- SCHEDULED AUTOS / NON-OWNED AUTOS check box ----
    // The two boxes stack and share this rule. At 2 px/pt it survives only at
    // each end: "####....................######". Of the real check boxes on
    // this form, located by their 14.5 x 12pt geometry, this is the only one
    // with a broken edge — and it is the edge the X sits against.
    { kind: "h", y: 446.3, x0: 105, x1: 118.8, t: R25, why: "SCHEDULED/NON-OWNED box divider", expect: "104->106  116->119" },

    // ---- LIMITS column, COMBINED SINGLE LIMIT row ----
    // Every other limits row scans 425->595. This one stops at 524.
    { kind: "h", y: 422.25, x0: 524, x1: 595, t: R25, why: "COMBINED SINGLE LIMIT row rule", expect: "36->51  425->524" },

    // ---- CERTIFICATE HOLDER / CANCELLATION divider ----
    // The two boxes sit side by side from 674 down to the form's bottom border
    // at 758, and the AUTHORIZED REPRESENTATIVE area is the lower part of the
    // right one. The scan finds the divider stopping at 727, which leaves the
    // signature block with no left edge — a line ending in mid-air.
    { kind: "v", x: 305.5, y0: 727, y1: 758, t: 0.5, why: "HOLDER/CANCELLATION divider", expect: "674->727" },

    // ---- PHONE / FAX cell divider ----
    // The PHONE row is split into a phone cell and a fax cell, and the real
    // document rules between them. Ours survives as a 1pt stub at x=482.25,
    // y 147->148 — immediately under the rule above, which is exactly where
    // such a divider starts. Without it the fax number sits in the same open
    // space as the phone number.
    { kind: "v", x: 482.25, y0: 146.4, y1: 158.25, t: R25, why: "PHONE/FAX cell divider", expect: "147->148 only" },
  ],

  /**
   * AUTHORIZED REPRESENTATIVE: the remnant scans as x 311.00 -> 402.63 with only
   * y 726.00 -> 726.88 left standing — under a point of glyph top. 91.63pt
   * across 25 characters puts it at Helvetica-Bold 5.85pt (Helvetica-Bold and
   * Arial-BoldMT share metrics, and Arial-BoldMT is what the form uses).
   */
  text: [
    {
      text: "AUTHORIZED REPRESENTATIVE",
      x: 311,
      yTop: 726,
      size: 5.85,
      capHeight: 0.718,
      clear: { x0: 309, y0: 724.5, x1: 406, y1: 732.5 },
      why: "bottom half erased by a white-out rectangle",
    },
  ],

  erase: [
    // A 6.5pt vertical stub standing on the bottom border at x=68.3, inside the
    // CERTIFICATE HOLDER box and joined to nothing above it. Scanning the three
    // empty boxes on this form (PRODUCER, INSURED, HOLDER) for marks turns up
    // this one and nothing else — the hits in the other two are their own
    // captions. Nothing on the real form sits here, so it is redaction debris,
    // and there is no line to complete: painting it out IS the repair.
    { x0: 67.4, y0: 750.5, x1: 69.3, y1: 757.9, why: "stray stub in the HOLDER box" },
    // The LIMITS column is split by a divider at x=514.6 that separates each
    // row's caption from its "$" amount cell. It has no business in the free
    // coverage block below: every row above carries a $ at x=518, and a probe
    // of the block for text finds NONE, so the divider there serves a column
    // that does not exist. It also does not run the block's full height — it
    // resumes at 567 after a gap, which is the signature of a remnant rather
    // than a designed rule. COI_TRUCK_SOLUTION.PDF settles it: on the real
    // document the divider stops at the E.L. DISEASE row and the free rows run
    // the full width, which is what coverages.other[].limitText assumes.
    { x0: 514.3, y0: 555.2, x1: 515.4, y1: 589.8, why: "$-column divider intruding on the free block" },
  ],
};

// --------------------------------------------------------------- ACORD 101

const ACORD101: Template = {
  name: "ACORD 101",
  src: "public/acord101-blank.pdf",
  png: "public/acord101-blank.png",
  pngWidth: 1275,
  repairs: [
    // ---- CARRIER / NAIC CODE / EFFECTIVE DATE row divider ----
    // Profiling this rule across its width gives 0.6875pt at x=150, 200, 350,
    // 500 and 560 but only 0.5625pt at x=60, 270 and 420: a sliver was shaved
    // off its top in three stretches. Redrawing the whole rule at the intact
    // weight restores the three and is a no-op over the rest.
    { kind: "h", y: 150.69, x0: 17, x1: 594, t: 0.6875, why: "CARRIER row divider", expect: "0.5625pt at x=60/270/420, 0.6875pt elsewhere" },

    // ---- FORM NUMBER / FORM TITLE underlines ----
    // Both survive only as a stub at the start plus the tail: the scan at y=190
    // reads 89.50->90.38, 99.88->129.13, 190.25->191.38, 304.50->589.88. The
    // stubs are where each underline should begin, so the gaps are the damage.
    { kind: "h", y: 189.88, x0: 90.3, x1: 100, t: 0.5, why: "FORM NUMBER underline", expect: "89.50->90.38  99.88->129.13" },
    { kind: "h", y: 189.88, x0: 191.3, x1: 304.6, t: 0.5, why: "FORM TITLE underline", expect: "190.25->191.38  304.50->589.88" },
  ],
  text: [],
  erase: [],
};

const TEMPLATES = [ACORD25, ACORD101];

// ----------------------------------------------------------------- measuring

/** Reports each repaired rule's real extent, so the tables can be re-checked. */
function scan(file: string, repairs: Seg[]) {
  const S = 8;
  const doc = mupdf.Document.openDocument(readFileSync(file), "application/pdf");
  const pix = doc
    .loadPage(0)
    .toPixmap(mupdf.Matrix.scale(S, S), mupdf.ColorSpace.DeviceRGB, false, true);
  const W = pix.getWidth();
  const H = pix.getHeight();
  const px = pix.getPixels();
  const dark = (x: number, y: number) => {
    const i = (y * W + x) * 3;
    return px[i] < 150 && px[i + 1] < 150 && px[i + 2] < 150;
  };

  const runsAlong = (fixed: number, span: number, horiz: boolean) => {
    const out: string[] = [];
    let s = -1;
    for (let b = 0; b < span; b++) {
      const on = horiz ? dark(b, fixed) : dark(fixed, b);
      if (on) { if (s < 0) s = b; }
      else if (s >= 0) { if (b - s >= 8 * S) out.push(`${(s / S).toFixed(0)}->${(b / S).toFixed(0)}`); s = -1; }
    }
    if (s >= 0 && span - s >= 8 * S) out.push(`${(s / S).toFixed(0)}->${(span / S).toFixed(0)}`);
    return out.join("  ") || "(none)";
  };

  for (const seg of repairs) {
    const found =
      seg.kind === "h"
        ? runsAlong(Math.round((seg.y + seg.t / 2) * S), W, true)
        : runsAlong(Math.round((seg.x + seg.t / 2) * S), H, false);
    const where = seg.kind === "h" ? `y=${seg.y}` : `x=${seg.x}`;
    console.log(`    ${where.padEnd(11)} ${seg.why.padEnd(33)} ${found}`);
  }
}

// ------------------------------------------------------------------- repair

async function repair(tpl: Template, check: boolean) {
  console.log(`\n${tpl.name}  (${tpl.src})`);
  console.log(`  before:`);
  scan(tpl.src, tpl.repairs);
  if (check) return;

  const backup = tpl.src.replace(/\.pdf$/, ".damaged.pdf");
  if (!existsSync(backup)) copyFileSync(tpl.src, backup);

  // Always rebuild from the untouched original, so re-running cannot compound.
  const pdf = await PDFDocument.load(readFileSync(backup));
  const page = pdf.getPages()[0];
  const H = page.getHeight();
  const black = rgb(0, 0, 0);

  // Debris first: a rule restored below must not then be painted out.
  for (const e of tpl.erase) {
    page.drawRectangle({
      x: e.x0,
      y: H - e.y1,
      width: e.x1 - e.x0,
      height: e.y1 - e.y0,
      color: rgb(1, 1, 1),
    });
  }

  for (const seg of tpl.repairs) {
    // The scan reports a rule's TOP (or LEFT) edge; pdf-lib centres a stroke on
    // its path, so shift by half a thickness to land on the same pixels.
    if (seg.kind === "h") {
      page.drawLine({
        start: { x: seg.x0, y: H - (seg.y + seg.t / 2) },
        end: { x: seg.x1, y: H - (seg.y + seg.t / 2) },
        thickness: seg.t,
        color: black,
      });
    } else {
      page.drawLine({
        start: { x: seg.x + seg.t / 2, y: H - seg.y0 },
        end: { x: seg.x + seg.t / 2, y: H - seg.y1 },
        thickness: seg.t,
        color: black,
      });
    }
  }

  if (tpl.text.length) {
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    for (const t of tpl.text) {
      page.drawRectangle({
        x: t.clear.x0,
        y: H - t.clear.y1,
        width: t.clear.x1 - t.clear.x0,
        height: t.clear.y1 - t.clear.y0,
        color: rgb(1, 1, 1),
      });
      page.drawText(t.text, {
        x: t.x,
        y: H - (t.yTop + t.size * t.capHeight),
        size: t.size,
        font: bold,
        color: black,
      });
    }
  }

  writeFileSync(tpl.src, await pdf.save());
  console.log(
    `  restored ${tpl.repairs.length} rule(s)` +
      (tpl.text.length ? ` + ${tpl.text.length} caption(s)` : "") +
      (tpl.erase.length ? ` + ${tpl.erase.length} fragment(s) erased` : "")
  );
  console.log(`  after:`);
  scan(tpl.src, tpl.repairs);

  // Keep the overlay's background in step with the PDF both renderers share.
  const doc = mupdf.Document.openDocument(readFileSync(tpl.src), "application/pdf");
  const scale = tpl.pngWidth / 612;
  const pix = doc
    .loadPage(0)
    .toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
  writeFileSync(tpl.png, pix.asPNG());
  console.log(`  wrote ${tpl.png}  ${pix.getWidth()}x${pix.getHeight()}`);
}

async function main() {
  const check = process.argv.includes("--check");
  for (const tpl of TEMPLATES) await repair(tpl, check);
}

main();
