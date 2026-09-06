/**
 * Generates the blank ACORD 101 Additional Remarks Schedule template from page
 * 2 of the sample certificate, by locating the sample's own data on the page
 * and painting it out. The official form structure is left untouched.
 *
 * Replaces the whited-out-by-hand-coordinates approach of scripts/gen_template.py
 * (which also required Python + PyMuPDF, neither of which is installed): the
 * rectangles here are FOUND by searching for the known sample values, so they
 * cannot drift out of alignment with the document.
 *
 *   npx tsx scripts/gen-acord101-template.mts
 *   -> public/acord101-blank.pdf, public/acord101-blank.png
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as mupdf from "mupdf";
import { PDFDocument, rgb } from "pdf-lib";

const ROOT = process.cwd();
const SRC = join(ROOT, "COI_TRUCK_SOLUTION.PDF");

/** Every value the sample filled in. Anything here gets painted out. */
const SAMPLE_DATA = [
  "Whittington Agency, LLC",
  "2026256248",
  "National General Insurance Company",
  "23728",
  "Smart Way Solutions Inc",
  "7059 Tallent Ct",
  "Sherrills Ford, NC, 28673-9763",
  "12/26/2025",
  "25",
  "CERTIFICATE OF LIABILITY INSURANCE",
  "2020, HINO",
  "2016, HINO",
  "2015, HINO",
  "2014, HINO",
];

/** Padding around a found box, in points, so antialiased edges vanish too. */
const PAD = 1.2;

async function main() {
  const bytes = readFileSync(SRC);
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const page = doc.loadPage(1); // page 2 = the ACORD 101

  const rects: [number, number, number, number][] = [];
  for (const needle of SAMPLE_DATA) {
    // search() -> one entry per hit, each a list of quads (one per wrapped line).
    for (const hit of page.search(needle)) {
      for (const q of hit as unknown as number[][]) {
        // Each quad is flat [ulx,uly, urx,ury, llx,lly, lrx,lry].
        const xs = [q[0], q[2], q[4], q[6]];
        const ys = [q[1], q[3], q[5], q[7]];
        rects.push([
          Math.min(...xs) - PAD,
          Math.min(...ys) - PAD,
          Math.max(...xs) + PAD,
          Math.max(...ys) + PAD,
        ]);
      }
    }
  }
  console.log(`found ${rects.length} data rectangles`);

  // The remarks body holds free text that will not be found by name, so clear
  // the whole writable area beneath the FORM NUMBER / FORM TITLE rule (194 pt).
  rects.push([23, 196, 589, 725]);

  // "Page _2_ of _2_" — digits only; the printed underlines below them stay.
  rects.push([534, 63, 546, 72.5]);
  rects.push([569, 63, 581, 72.5]);

  const src = await PDFDocument.load(bytes);
  const out = await PDFDocument.create();
  const [copied] = await out.copyPages(src, [1]);
  out.addPage(copied);

  const H = copied.getHeight();
  for (const [x0, y0, x1, y1] of rects) {
    copied.drawRectangle({
      x: x0,
      y: H - y1, // mupdf reports top-left origin; pdf-lib draws bottom-left
      width: x1 - x0,
      height: y1 - y0,
      color: rgb(1, 1, 1),
      borderWidth: 0,
    });
  }

  const pdfBytes = await out.save();
  writeFileSync(join(ROOT, "public", "acord101-blank.pdf"), pdfBytes);
  console.log(`wrote public/acord101-blank.pdf (${pdfBytes.length} bytes)`);

  const png = mupdf.Document.openDocument(Buffer.from(pdfBytes), "application/pdf")
    .loadPage(0)
    .toPixmap(mupdf.Matrix.scale(150 / 72, 150 / 72), mupdf.ColorSpace.DeviceRGB, false, true)
    .asPNG();
  writeFileSync(join(ROOT, "public", "acord101-blank.png"), png);
  console.log("wrote public/acord101-blank.png");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
