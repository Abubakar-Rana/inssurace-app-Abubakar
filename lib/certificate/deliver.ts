/**
 * Send an issued certificate back to whoever asked for it.
 *
 * ---------------------------------------------------------------------------
 * RULES THIS ENFORCES
 *
 * 1. Only ISSUED certificates go out. A draft is work in progress; emailing one
 *    puts an unreviewed document in a holder's hands, and they will rely on it.
 *
 * 2. Delivery is never automatic. Approval and sending are separate human
 *    actions, deliberately — an agency must be able to issue a certificate and
 *    decide later whether, when, and to whom it goes.
 *
 * 3. The bytes sent are re-rendered from the stored snapshot, so what the
 *    holder receives is what was approved, not what the policy says today.
 *    The hash is checked against `pdfSha256` before sending; a mismatch aborts.
 *
 * 4. The send happens BEFORE the database records it. If SMTP fails, nothing is
 *    written and the reviewer can retry. The opposite order would let us record
 *    a delivery that never happened — worse than a retry, because the agency
 *    would believe the holder had the document.
 * ---------------------------------------------------------------------------
 */

import { eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { certificates, coiRequests, deliveries } from "@/db/schema";
import { audit } from "@/lib/audit";
import { ServiceError } from "./service";
import { certificateFileName, renderCertificatePdf, sha256 } from "./render";
import { sendReply, DeliveryBlocked, AUTO_HEADER } from "@/lib/gmail/send";
import type { Certificate } from "./types";
import type { Session } from "@/lib/auth/session";

export interface DeliveryResult {
  deliveryId: string;
  to: string;
  threaded: boolean;
  providerMessageId: string;
  certificateNumber: string;
  revision: number;
}

/** The covering note. Plain text on purpose — it has to read correctly in every
 *  client, and there is nothing here that formatting would clarify. */
function coveringNote(cert: Certificate, revision: number): string {
  const lines = [
    `Please find attached the certificate of insurance for ${cert.insured.name}.`,
    "",
    `Certificate number: ${cert.certificateNumber}${revision > 0 ? ` (revision ${revision})` : ""}`,
    `Issued: ${cert.date}`,
  ];

  if (cert.acord101) {
    lines.push(
      "",
      "The attached document has two pages: the ACORD 25 certificate and an",
      "ACORD 101 Additional Remarks Schedule listing the remaining vehicles."
    );
  }

  lines.push(
    "",
    "This certificate is issued as a matter of information only and confers no",
    "rights upon the certificate holder.",
    "",
    cert.producer.name,
    cert.producer.phone,
    cert.producer.email
  );

  return lines.join("\n");
}

/**
 * Deliver a certificate as a reply to the request that prompted it.
 *
 * `to` may be supplied to override the requester's address — the reviewer sees
 * and confirms the recipient in the UI, and compliance inboxes are often a
 * different address from the person who wrote in.
 */
export async function deliverCertificate(
  session: Session,
  certificateId: string,
  overrideTo?: string
): Promise<DeliveryResult> {
  // ---- read what we need, and refuse early ----
  const { certificate, request } = await withTenant(session.tenantId, async (tx) => {
    const [certificate] = await tx
      .select()
      .from(certificates)
      .where(eq(certificates.id, certificateId));
    if (!certificate) throw new ServiceError("Certificate not found.", 404);

    if (certificate.status !== "issued") {
      throw new ServiceError(
        `Certificate is ${certificate.status}. Only an issued certificate can be sent.`,
        409
      );
    }

    const [request] = certificate.requestId
      ? await tx.select().from(coiRequests).where(eq(coiRequests.id, certificate.requestId))
      : [undefined];

    return { certificate, request };
  });

  const snapshot = certificate.snapshot as Certificate;
  const to = (overrideTo ?? request?.fromAddr ?? "").trim();
  if (!to) {
    throw new ServiceError(
      "No recipient: this certificate has no originating request, so an address must be supplied.",
      400
    );
  }

  // ---- re-render and verify against what was approved ----
  const bytes = await renderCertificatePdf(snapshot);
  const digest = sha256(bytes);

  if (certificate.pdfSha256 && certificate.pdfSha256 !== digest) {
    // Deterministic rendering means this should be impossible. If it happens,
    // something changed underneath an issued document — refuse and let a human
    // investigate rather than mailing bytes nobody approved.
    throw new ServiceError(
      "Refusing to send: the re-rendered PDF does not match the approved document.",
      500
    );
  }

  // ---- send, then record ----
  let sent;
  try {
    sent = await sendReply({
      tenantId: session.tenantId,
      to,
      subject: request?.subject ?? `Certificate of insurance — ${snapshot.insured.name}`,
      text: coveringNote(snapshot, certificate.revision),
      inReplyTo: request?.gmailMessageId ?? null,
      threadId: request?.gmailThreadId ?? null,
      // Marks this as our own output so ingestion does not read it back.
      // Until follow-ups were ingested this did not matter: a reply in a
      // handled thread was dropped anyway. Now that a reply in a thread
      // BECOMES a request, our own certificate mail landing back in the
      // watched mailbox would open a request to answer itself.
      headers: { [AUTO_HEADER]: "certificate" },
      attachments: [
        {
          filename: certificateFileName(snapshot),
          content: Buffer.from(bytes),
          contentType: "application/pdf",
        },
      ],
    });
  } catch (err) {
    if (err instanceof DeliveryBlocked) throw new ServiceError(err.message, 422);
    throw err;
  }

  return withTenant(session.tenantId, async (tx) => {
    const [row] = await tx
      .insert(deliveries)
      .values({
        tenantId: session.tenantId,
        certificateId,
        method: "email",
        toAddr: to,
        sentBy: session.userId,
        providerMessageId: sent.messageId,
      })
      .returning();

    if (request) {
      await tx.update(coiRequests).set({ status: "sent" }).where(eq(coiRequests.id, request.id));
    }

    await audit(tx, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "certificate.delivered",
      subjectType: "certificate",
      subjectId: certificateId,
      after: {
        to,
        method: "email",
        certificateNumber: certificate.certificateNumber,
        revision: certificate.revision,
        pdfSha256: digest,
        providerMessageId: sent.messageId,
        inReplyTo: request?.gmailMessageId ?? null,
      },
    });

    return {
      deliveryId: row.id,
      to,
      threaded: Boolean(request?.gmailMessageId),
      providerMessageId: sent.messageId,
      certificateNumber: certificate.certificateNumber,
      revision: certificate.revision,
    };
  });
}

/** Past deliveries for a certificate — shown so a reviewer can see it already went. */
export async function listDeliveries(session: Session, certificateId: string) {
  return withTenant(session.tenantId, (tx) =>
    tx
      .select({
        id: deliveries.id,
        toAddr: deliveries.toAddr,
        method: deliveries.method,
        sentAt: deliveries.sentAt,
      })
      .from(deliveries)
      .where(eq(deliveries.certificateId, certificateId))
  );
}
