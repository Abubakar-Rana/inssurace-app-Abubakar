/**
 * Server-side PDF rendering.
 *
 * lib/acordPdf.js fetches its blank templates over HTTP because it normally
 * runs in the browser. On the server there is no origin to fetch from, so the
 * templates are read off disk once and cached for the life of the process.
 *
 * Rendering server-side is what lets approval hash the real bytes: the digest
 * recorded against a certificate is of the same document that gets delivered,
 * not of a client-side re-render that might differ.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildCertificatePdf } from "@/lib/acordPdf";
import type { Certificate } from "./types";

let templates: Promise<{ acord25: Buffer; acord101: Buffer }> | null = null;

function loadTemplates() {
  templates ??= (async () => {
    const dir = join(process.cwd(), "public");
    const [acord25, acord101] = await Promise.all([
      readFile(join(dir, "acord25-blank.pdf")),
      readFile(join(dir, "acord101-blank.pdf")),
    ]);
    return { acord25, acord101 };
  })();
  return templates;
}

export async function renderCertificatePdf(cert: Certificate): Promise<Uint8Array> {
  const { acord25, acord101 } = await loadTemplates();
  return buildCertificatePdf(cert, acord25, acord101);
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Filename a recipient sees. Mirrors certFileName in lib/acordPdf.js. */
export function certificateFileName(cert: Certificate): string {
  const name = (cert?.insured?.name || "certificate").replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "");
  return `${name}_COI.pdf`;
}
