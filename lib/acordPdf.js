// Fills the REAL blank ACORD 25 PDF (public/acord25-blank.pdf) with certificate
// data using the shared coordinate map, so the downloaded/emailed document is
// byte-for-byte the same template as COI TRUCK SOLUTION.PDF.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { PAGE, TEXT, CHECKS, isChecked } from "./acordMap";
import { getPath } from "./path";

const COLOR = rgb(0.06, 0.14, 0.25);
const ASCENT = 0.8; // baseline ≈ top + size*ASCENT

const INSURER_ROWS = ["A", "B", "C", "D", "E", "F"].map((letter, i) => ({ letter, y: 184 + i * 12 }));

export async function buildCertificatePdf(cert) {
  const bytes = await fetch("/acord25-blank.pdf").then((r) => r.arrayBuffer());
  const pdf = await PDFDocument.load(bytes);
  const page = pdf.getPages()[0];
  const H = page.getHeight();

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const pick = (f) => (f.italic ? italic : f.bold ? bold : regular);

  function drawLine(text, f, yTop) {
    if (text == null || text === "") return;
    const str = String(text);
    const ft = pick(f);
    const size = f.size;
    const w = ft.widthOfTextAtSize(str, size);
    let x = f.x;
    if (f.align === "right") x = f.x + f.w - w;
    else if (f.align === "center") x = f.x + (f.w - w) / 2;
    page.drawText(str, { x, y: H - (yTop + size * ASCENT), size, font: ft, color: COLOR });
  }

  for (const f of TEXT) {
    const v = getPath(cert, f.path);
    if (v == null || v === "") continue;
    if (f.multi) {
      const lh = f.lh || f.size * 1.18;
      String(v)
        .split("\n")
        .forEach((ln, i) => drawLine(ln, f, f.y + i * lh));
    } else {
      drawLine(String(v), f, f.y);
    }
  }

  for (const { letter, y } of INSURER_ROWS) {
    const rec = (cert.insurers || []).find((it) => it.letter === letter);
    if (!rec) continue;
    drawLine(rec.name, { x: 352, w: 182, size: 10, bold: true, align: "left" }, y);
    drawLine(rec.naic, { x: 540, w: 50, size: 10, bold: true, align: "left" }, y);
  }

  for (const chk of CHECKS) {
    if (!isChecked(getPath(cert, chk.path), chk)) continue;
    if (chk.gate && !getPath(cert, chk.gate)) continue;
    const size = 10;
    page.drawText("X", { x: chk.x - 1, y: H - (chk.y + size * ASCENT), size, font: bold, color: COLOR });
  }

  return pdf.save();
}

export async function downloadCertificatePdf(cert, filename = "certificate.pdf") {
  const bytes = await buildCertificatePdf(cert);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function certFileName(cert) {
  const name = (cert?.insured?.name || "certificate").replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "");
  return `${name}_COI.pdf`;
}
