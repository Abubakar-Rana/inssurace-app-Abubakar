// Fills the REAL blank ACORD 25 PDF (public/acord25-blank.pdf) with certificate
// data using the shared coordinate map, so the downloaded/emailed document is
// byte-for-byte the same template as COI TRUCK SOLUTION.PDF.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { PAGE, TEXT, CHECKS, isChecked, DATA } from "./acordMap";
import { TEXT as TEXT_101 } from "./acord101Map";
import { getPath } from "./path";
import { fontStyleOf, wrapBlock } from "./certificate/text";

const COLOR = rgb(0, 0, 0); // the sample prints data in black; navy read as an overlay
const ASCENT = 0.8; // baseline ≈ top + size*ASCENT

// Fixed document timestamp — see the note at the end of buildCertificatePdf.
// The dates that matter are printed on the form, not in the file metadata.
const EPOCH = new Date(Date.UTC(2000, 0, 1));

const INSURER_ROWS = ["A", "B", "C", "D", "E", "F"].map((letter, i) => ({ letter, y: 184 + i * 12 }));

/**
 * @param cert      the certificate object
 * @param template  optional blank-form bytes. The browser leaves this out and
 *                  the template is fetched from /public; Node callers (scripts,
 *                  and later the API route that renders for delivery) pass the
 *                  file in, since there is no fetch origin server-side.
 */
/** Binds the shared map-driven drawing routine to one page of one document. */
function painter(pdf, page, fonts) {
  const H = page.getHeight();
  const pick = (f) => (f.italic ? fonts.italic : f.bold ? fonts.bold : fonts.regular);

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

  function drawFields(fields, source) {
    for (const f of fields) {
      const v = getPath(source, f.path);
      if (v == null || v === "") continue;
      if (f.multi) {
        const lh = f.lh || f.size * 1.18;
        // The assembler already wrapped generated text to this width, so this
        // is normally a no-op. It matters after a reviewer edits the box by
        // hand: without it a long typed line prints straight off the form.
        const maxLines = Math.floor(f.h / lh);
        wrapBlock(String(v), f.w, f.size, fontStyleOf(f))
          .slice(0, maxLines)
          .forEach((ln, i) => drawLine(ln, f, f.y + i * lh));
      } else {
        drawLine(String(v), f, f.y);
      }
    }
  }

  function drawChecks(checks, source) {
    for (const chk of checks) {
      if (!isChecked(getPath(source, chk.path), chk)) continue;
      if (chk.gate && !getPath(source, chk.gate)) continue;
      const size = 10;
      page.drawText("X", {
        x: chk.x - 1,
        y: H - (chk.y + size * ASCENT),
        size,
        font: fonts.bold,
        color: COLOR,
      });
    }
  }

  return { drawLine, drawFields, drawChecks };
}

/**
 * @param cert      the certificate object
 * @param template  optional blank ACORD 25 bytes. The browser leaves this out
 *                  and the template is fetched from /public; Node callers pass
 *                  the file in, since there is no fetch origin server-side.
 * @param template101 optional blank ACORD 101 bytes, needed only when the
 *                  certificate overflows onto a second page.
 */
export async function buildCertificatePdf(cert, template, template101) {
  const bytes = template ?? (await fetch("/acord25-blank.pdf").then((r) => r.arrayBuffer()));
  const pdf = await PDFDocument.load(bytes);

  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };

  const p1 = painter(pdf, pdf.getPages()[0], fonts);
  p1.drawFields(TEXT, cert);
  p1.drawChecks(CHECKS, cert);

  for (const { letter, y } of INSURER_ROWS) {
    const rec = (cert.insurers || []).find((it) => it.letter === letter);
    if (!rec) continue;
    p1.drawLine(rec.name, { x: 352, w: 182, size: DATA, align: "left" }, y);
    p1.drawLine(rec.naic, { x: 540, w: 50, size: DATA, align: "left" }, y);
  }

  // ---- page 2: ACORD 101, only when page 1 overflowed ----
  if (cert.acord101) {
    const blank101 =
      template101 ?? (await fetch("/acord101-blank.pdf").then((r) => r.arrayBuffer()));
    const src = await PDFDocument.load(blank101);
    const [copied] = await pdf.copyPages(src, [0]);
    pdf.addPage(copied);
    painter(pdf, copied, fonts).drawFields(TEXT_101, cert);
  }

  // Determinism. Without this pdf-lib stamps the current time into the document
  // metadata and the same certificate hashes differently on every render —
  // which would make `certificates.pdfSha256` meaningless the moment anyone
  // reprints. Fixed values here mean "same snapshot in, same bytes out", so the
  // digest recorded at approval still identifies the document later.
  pdf.setProducer("CertFlow");
  pdf.setCreator("CertFlow");
  pdf.setCreationDate(EPOCH);
  pdf.setModificationDate(EPOCH);

  return pdf.save({ useObjectStreams: false });
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
