/**
 * Text measurement and line breaking — the one place that decides how a string
 * becomes lines on the form.
 *
 * WHY THIS EXISTS: the DESCRIPTION OF OPERATIONS box is 562 pt wide and holds a
 * fixed number of lines. Whether a fleet fits on page 1 or spills onto an ACORD
 * 101 therefore depends on where text wraps. If the assembler guessed at that
 * and the PDF renderer wrapped differently, the certificate would either run
 * off the edge of the box or push content the reader never sees. Both are
 * defects on a legal document.
 *
 * So: wrapping happens ONCE, here, and everything downstream draws the result
 * verbatim. Pure and synchronous — no fonts to embed, no async, same answer in
 * the browser, on the server and in tests.
 */

import { FIRST_CODE, HELVETICA_WIDTHS } from "./fontMetrics";

export type FontStyle = "regular" | "bold" | "italic";

export function fontStyleOf(f: { bold?: boolean; italic?: boolean }): FontStyle {
  return f.italic ? "italic" : f.bold ? "bold" : "regular";
}

/** Width of `text` at `size` points. */
export function measureText(text: string, size: number, style: FontStyle = "regular"): number {
  const widths = HELVETICA_WIDTHS[style];
  let em = 0;
  for (let i = 0; i < text.length; i++) {
    const idx = text.charCodeAt(i) - FIRST_CODE;
    // Unmapped codes (control chars, anything past WinAnsi) fall back to the
    // width of a space rather than zero, so they can never under-measure.
    em += (idx >= 0 && idx < widths.length ? widths[idx] : widths[0]) ?? widths[0];
  }
  return (em * size) / 1000;
}

/**
 * Break one logical line into as many visual lines as it needs.
 *
 * Breaks at spaces. A single word wider than the box (a 17-character VIN glued
 * to a label, say) is hard-split rather than allowed to overflow — losing a
 * character boundary is recoverable, printing outside the box is not.
 */
export function wrapLine(text: string, maxWidth: number, size: number, style: FontStyle = "regular"): string[] {
  if (!text) return [""];
  if (measureText(text, size, style) <= maxWidth) return [text];

  const lines: string[] = [];
  let current = "";

  for (const word of text.split(" ")) {
    const candidate = current ? `${current} ${word}` : word;
    if (measureText(candidate, size, style) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = "";
    }
    // The word alone may still be too wide.
    let rest = word;
    while (measureText(rest, size, style) > maxWidth) {
      let cut = rest.length - 1;
      while (cut > 1 && measureText(rest.slice(0, cut), size, style) > maxWidth) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    current = rest;
  }

  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

/** Wrap a block of logical lines (split on "\n") into visual lines. */
export function wrapBlock(text: string, maxWidth: number, size: number, style: FontStyle = "regular"): string[] {
  return text.split("\n").flatMap((line) => wrapLine(line, maxWidth, size, style));
}
