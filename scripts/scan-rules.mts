/**
 * Reports where every printed rule on a form page actually starts and stops.
 *
 * This is the measuring instrument behind scripts/repair-acord25-template.mts
 * and its ACORD 101 counterpart. The blank templates were produced by painting
 * white rectangles over a filled form, and wherever one of those crossed a rule
 * it took the rule with it. A rule that stops mid-cell is damage, and this is
 * how you see it rather than guess at it.
 *
 *   npx tsx scripts/scan-rules.mts public/acord101-blank.pdf h 80 210
 *   npx tsx scripts/scan-rules.mts public/acord25-blank.pdf  v 300 320
 *
 * Axis "h" scans rows and prints x-extents; "v" scans columns and prints
 * y-extents. Coordinates are the TOP-LEFT-origin points lib/acordMap.js uses.
 */
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";

const [file, axis = "h", froms, tos] = process.argv.slice(2);
if (!file) {
  console.error("usage: tsx scripts/scan-rules.mts <file.pdf> [h|v] [from] [to]");
  process.exit(1);
}
const S = 4; // px per pt
const doc = mupdf.Document.openDocument(readFileSync(file), "application/pdf");
const pix = doc
  .loadPage(0)
  .toPixmap(mupdf.Matrix.scale(S, S), mupdf.ColorSpace.DeviceRGB, false, true);
const W = pix.getWidth();
const H = pix.getHeight();
const px = pix.getPixels();
const dark = (x: number, y: number) => {
  const i = (y * W + x) * 3;
  return px[i] < 140 && px[i + 1] < 140 && px[i + 2] < 140;
};

const from = Math.round(Number(froms ?? 0) * S);
const to = Math.round(Number(tos ?? (axis === "h" ? 792 : 612)) * S);
const span = axis === "h" ? W : H;

for (let a = from; a < Math.min(to, axis === "h" ? H : W); a++) {
  const runs: [number, number][] = [];
  let s = -1;
  for (let b = 0; b < span; b++) {
    const isDark = axis === "h" ? dark(b, a) : dark(a, b);
    if (isDark) { if (s < 0) s = b; }
    else if (s >= 0) { if (b - s >= 12 * S) runs.push([s, b]); s = -1; }
  }
  if (s >= 0 && span - s >= 12 * S) runs.push([s, span]);
  if (!runs.length) continue;
  const total = runs.reduce((n, [x, y]) => n + (y - x), 0);
  if (total < 40 * S) continue; // a row of text is not a rule
  console.log(
    `${axis}=${(a / S).toFixed(2).padStart(7)}  ` +
      runs.map(([x, y]) => `${(x / S).toFixed(0)}->${(y / S).toFixed(0)}`).join("  ")
  );
}
