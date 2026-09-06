/**
 * Rasterises a PDF to PNG so generated certificates can be eyeballed.
 *
 * Replaces the PyMuPDF dependency the old scripts/gen_template.py needed —
 * mupdf here is the WASM build, so it runs anywhere Node runs with no Python
 * and no native toolchain.
 *
 *   npx tsx scripts/pdf-to-png.ts out/certificate.pdf out/certificate  [dpi]
 *   -> out/certificate-p1.png, out/certificate-p2.png, …
 */

import { readFileSync, writeFileSync } from "node:fs";
import * as mupdf from "mupdf";

const [, , src, destPrefix, dpiArg] = process.argv;
if (!src || !destPrefix) {
  console.error("usage: tsx scripts/pdf-to-png.ts <src.pdf> <dest-prefix> [dpi]");
  process.exit(1);
}

const dpi = Number(dpiArg ?? 110);
const doc = mupdf.Document.openDocument(readFileSync(src), "application/pdf");
const matrix = mupdf.Matrix.scale(dpi / 72, dpi / 72);

for (let i = 0; i < doc.countPages(); i++) {
  const pixmap = doc.loadPage(i).toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
  const out = `${destPrefix}-p${i + 1}.png`;
  writeFileSync(out, pixmap.asPNG());
  console.log(`${out}  ${pixmap.getWidth()}x${pixmap.getHeight()}`);
}
