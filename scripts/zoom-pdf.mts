/**
 * Crops a region out of a PDF page and rasterises it large, so fine detail —
 * a rule's weight, a checkbox that lost an edge — can actually be seen.
 *
 * Region is given in the same TOP-LEFT-origin points as lib/acordMap.js.
 *
 *   npx tsx scripts/zoom-pdf.mts public/acord25-blank.pdf out/z.png 30 415 200 50
 *   npx tsx scripts/zoom-pdf.mts out/certificate.pdf out/z.png 300 112 300 80 300
 *   npx tsx scripts/zoom-pdf.mts out/certificate.pdf out/z.png 18 80 578 130 260 2   # page 2
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import * as mupdf from "mupdf";

const [src, out, xs, ys, ws, hs, dpis, pages] = process.argv.slice(2);
if (!src || !out) {
  console.error("usage: tsx scripts/zoom-pdf.mts <src.pdf> <out.png> <x> <y> <w> <h> [dpi]");
  process.exit(1);
}
const [x, y, w, h] = [xs, ys, ws, hs].map(Number);
const pdf = await PDFDocument.load(readFileSync(src));
const pageNo = Number(pages ?? 1) - 1;
const page = pdf.getPages()[pageNo];
page.setCropBox(x, page.getHeight() - (y + h), w, h);
const doc = mupdf.Document.openDocument(await pdf.save(), "application/pdf");
const dpi = Number(dpis ?? 200);
const pix = doc
  .loadPage(pageNo)
  .toPixmap(mupdf.Matrix.scale(dpi / 72, dpi / 72), mupdf.ColorSpace.DeviceRGB, false, true);
writeFileSync(out, pix.asPNG());
console.log(`${out}  ${pix.getWidth()}x${pix.getHeight()}`);
