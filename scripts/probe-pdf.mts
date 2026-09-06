/**
 * Prints where text sits on a PDF page, in the top-left-origin points that
 * lib/acordMap.js uses.
 *
 * This is how coordinates get derived: instead of guessing at a field position,
 * find where a filled-in sample put that value and copy the number. Run with a
 * search term to locate specific values, or without one to dump every line.
 *
 *   npx tsx scripts/probe-pdf.mts COI_TRUCK_SOLUTION.PDF 2
 *   npx tsx scripts/probe-pdf.mts COI_TRUCK_SOLUTION.PDF 2 "Smart Way"
 */

import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";

const [, , file, pageArg, needle] = process.argv;
if (!file) {
  console.error('usage: tsx scripts/probe-pdf.mts <file.pdf> [page=1] ["search text"]');
  process.exit(1);
}

const doc = mupdf.Document.openDocument(readFileSync(file), "application/pdf");
const page = doc.loadPage(Number(pageArg ?? 1) - 1);

if (needle) {
  const hits = page.search(needle);
  if (!hits.length) console.log(`no match for "${needle}"`);
  for (const hit of hits) {
    for (const q of hit as unknown as number[][]) {
      console.log(
        `x=${q[0].toFixed(1).padStart(6)}  y=${q[1].toFixed(1).padStart(6)}  ` +
          `w=${(q[2] - q[0]).toFixed(1).padStart(6)}  h=${(q[5] - q[1]).toFixed(1)}   ${needle}`
      );
    }
  }
} else {
  const st = JSON.parse(page.toStructuredText().asJSON());
  for (const block of st.blocks ?? []) {
    for (const line of block.lines ?? []) {
      const b = line.bbox;
      const text = (line.text ?? "").trim();
      if (!text) continue;
      console.log(
        `x=${b.x.toFixed(1).padStart(6)}  y=${b.y.toFixed(1).padStart(6)}  ` +
          `h=${b.h.toFixed(1).padStart(5)}   ${text}`
      );
    }
  }
}
