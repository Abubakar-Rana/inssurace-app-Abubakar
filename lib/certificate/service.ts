/**
 * Certificate lifecycle: draft -> edited -> approved.
 *
 * The route handlers are thin wrappers over these functions; everything that
 * decides *what happens* lives here, in one transaction per operation with its
 * audit entry written alongside the change.
 *
 * The rule that shapes this file: an APPROVED certificate is never re-derived
 * from live policy data. Policies renew and limits change, and a reprint has to
 * show what was actually certified on the day it was issued. So approval
 * freezes `snapshot`, and a correction creates a new revision rather than
 * mutating the old one.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { withTenant, type TenantDb } from "@/lib/db/client";
import { audit } from "@/lib/audit";
import { certificates, coiRequests, producers, tenants } from "@/db/schema";
import { extractHolder, upsertHolder } from "@/lib/matching/holder";
import { wantsVins } from "@/lib/matching/vinRequest";
import { loadAssembleInput } from "./load";
import { assembleCertificate } from "./assemble";
import type { Certificate } from "./types";
import type { Session } from "@/lib/auth/session";

export class ServiceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
  }
}

export interface CertificateRecord {
  id: string;
  requestId: string | null;
  clientId: string;
  certificateNumber: string;
  revision: number;
  /** A reviewer "approves"; the resulting state is `issued` — the agency has
   *  produced a final document. Delivery is tracked separately in `deliveries`,
   *  because a certificate can be issued and then sent more than once. */
  status: "draft" | "issued" | "voided";
  snapshot: Certificate;
  approvedAt: Date | null;
  createdAt: Date;
}

/**
 * Next certificate number for the tenant: COI-<year>-<0001>.
 *
 * Counts inside the caller's transaction under an advisory lock, so two
 * reviewers generating at the same instant cannot land on the same number. The
 * unique index on (tenant, number, revision) is the backstop.
 */
async function nextCertificateNumber(tx: TenantDb, tenantId: string): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`certno:${tenantId}`}))`);
  const year = new Date().getUTCFullYear();
  const prefix = `COI-${year}-`;
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(certificates)
    .where(and(eq(certificates.tenantId, tenantId), sql`${certificates.certificateNumber} like ${prefix + "%"}`));
  return `${prefix}${String((row?.n ?? 0) + 1).padStart(4, "0")}`;
}

function toRecord(row: typeof certificates.$inferSelect): CertificateRecord {
  return {
    id: row.id,
    requestId: row.requestId,
    clientId: row.clientId,
    certificateNumber: row.certificateNumber,
    revision: row.revision,
    status: row.status,
    snapshot: row.snapshot as Certificate,
    approvedAt: row.approvedAt,
    createdAt: row.createdAt,
  };
}

export interface GenerateContext {
  tenantId: string;
  /** null when the system generated it — polling has no signed-in user. */
  actorUserId: string | null;
  /** Empty means "the agency's default producer contact". */
  authorizedRep?: string;
}

/** A reviewer generates: they are the actor, and they sign it. */
export async function generateForRequest(
  session: Session,
  requestId: string
): Promise<CertificateRecord> {
  return generateDraft(
    { tenantId: session.tenantId, actorUserId: session.userId, authorizedRep: session.email },
    requestId
  );
}

/**
 * Assemble a draft certificate for a matched request.
 *
 * Runs unattended: polling calls this the moment a request resolves to an
 * insured, so a reviewer opens a finished document to check rather than an
 * empty one to trigger. Nothing about that weakens the lifecycle — a draft is
 * still only a draft, and issuing it is still a human action.
 *
 * Idempotent: a request that already has a draft returns it rather than
 * generating a second one, so a double-click — or a re-poll — cannot burn a
 * certificate number.
 *
 * Regenerating after the certificate was issued produces the NEXT REVISION of
 * the same certificate number, not a new one. A holder who received COI-2026-
 * 0001 and later receives a correction expects to see that number again with a
 * higher revision — a fresh number reads as a second, unrelated certificate,
 * and leaves the first one apparently still in force.
 */
export async function generateDraft(
  ctx: GenerateContext,
  requestId: string
): Promise<CertificateRecord> {
  const session = { tenantId: ctx.tenantId, userId: ctx.actorUserId } as const;
  return withTenant(session.tenantId, async (tx) => {
    const [request] = await tx.select().from(coiRequests).where(eq(coiRequests.id, requestId));
    if (!request) throw new ServiceError("Request not found.", 404);
    if (!request.clientId) {
      throw new ServiceError("Request is not matched to an insured yet.");
    }

    // Latest certificate for this request, whatever its state.
    const [latest] = await tx
      .select()
      .from(certificates)
      .where(eq(certificates.requestId, requestId))
      .orderBy(desc(certificates.revision))
      .limit(1);

    if (latest?.status === "draft") return toRecord(latest);

    // ---- the holder is read from the email, not from a stored list ----
    //
    // Re-derived on every draft while the body is still here, because the
    // holder IS the requester and the email is the only statement of who that
    // is. Once the body has been purged on the L6 clock the stored id is all
    // that remains, and that is what a later revision uses.
    const holderId = request.bodyText
      ? await upsertHolder(
          tx,
          session.tenantId,
          extractHolder({
            subject: request.subject,
            body: request.bodyText,
            fromAddr: request.fromAddr,
            fromName: request.fromName,
          }),
          request.fromAddr
        )
      : request.holderId;

    if (!holderId) {
      throw new ServiceError(
        "No certificate holder: the request has no signature to read and no stored holder."
      );
    }
    if (holderId !== request.holderId) {
      await tx.update(coiRequests).set({ holderId }).where(eq(coiRequests.id, requestId));
    }

    // Did the requester ask for vehicle identification numbers? Read from the
    // whole email, and defaulting to "no" when the body is gone.
    const vinRequest = request.bodyText
      ? wantsVins({ subject: request.subject, body: request.bodyText })
      : { wanted: false, evidence: "the request body is no longer stored" };

    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId));

    // Nobody signed off on an automatically drafted certificate, so it carries
    // the agency's producer contact rather than a person who has not seen it.
    // The reviewer's approval is recorded in `approvedBy`, which is the field
    // that actually means someone stood behind this document.
    let authorizedRep = ctx.authorizedRep ?? "";
    if (!authorizedRep) {
      const [producer] = await tx
        .select({ contactName: producers.contactName, name: producers.name })
        .from(producers)
        .where(eq(producers.isDefault, true))
        .limit(1);
      authorizedRep = producer?.contactName || producer?.name || "";
    }

    // Reuse the number and bump the revision when superseding an issued
    // certificate; only a genuinely new one draws a new number.
    const certificateNumber = latest
      ? latest.certificateNumber
      : await nextCertificateNumber(tx, session.tenantId);
    const revision = latest ? latest.revision + 1 : 0;

    const input = await loadAssembleInput(
      {
        tenantId: session.tenantId,
        clientId: request.clientId,
        holderId,
        certificateNumber,
        issueDate: todayAcord(),
        authorizedRep,
        acordEdition: tenant?.acordEdition ?? "2025/12",
        // VINs only when the request asked for them. See the note in
        // lib/matching/vinRequest.ts for why silence means "leave them out".
        includeVins: vinRequest.wanted,
      },
      tx
    );
    // A certificate with no coverage rows is not a lesser certificate; it is a
    // document that asserts nothing while looking exactly like one that does.
    // Refusing puts the request in front of a person, which is the right place
    // for "this insured has no active policies" to be noticed.
    if (!input.policies.length) {
      throw new ServiceError(
        `${input.insured.name} has no active policies on file, so there is nothing to certify.`
      );
    }

    const snapshot = assembleCertificate(input);

    const [row] = await tx
      .insert(certificates)
      .values({
        tenantId: session.tenantId,
        requestId,
        clientId: request.clientId,
        certificateNumber,
        revision,
        acordEdition: snapshot.acordEdition,
        snapshot,
        status: "draft",
      })
      .returning();

    await tx
      .update(coiRequests)
      .set({ status: "ready" })
      .where(eq(coiRequests.id, requestId));

    await audit(tx, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "certificate.generated",
      subjectType: "certificate",
      subjectId: row.id,
      after: {
        certificateNumber,
        revision,
        requestId,
        clientId: request.clientId,
        // Recorded because it changes what the document discloses. If a holder
        // ever asks why VINs were or were not listed, this is the answer.
        includeVins: vinRequest.wanted,
        vinReason: vinRequest.evidence,
      },
    });

    return toRecord(row);
  });
}

/** Save reviewer edits. Only a draft may change. */
export async function updateSnapshot(
  session: Session,
  certificateId: string,
  snapshot: Certificate
): Promise<CertificateRecord> {
  return withTenant(session.tenantId, async (tx) => {
    const [row] = await tx.select().from(certificates).where(eq(certificates.id, certificateId));
    if (!row) throw new ServiceError("Certificate not found.", 404);
    if (row.status !== "draft") {
      throw new ServiceError(
        `Certificate is ${row.status} and cannot be edited. Create a new revision instead.`,
        409
      );
    }

    // The identifiers are ours, not the client's — accepting them from the
    // request body would let a reviewer renumber an issued document.
    const merged: Certificate = {
      ...snapshot,
      certificateNumber: row.certificateNumber,
      acordEdition: row.acordEdition,
    };

    const [updated] = await tx
      .update(certificates)
      .set({ snapshot: merged })
      .where(eq(certificates.id, certificateId))
      .returning();

    await audit(tx, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "certificate.edited",
      subjectType: "certificate",
      subjectId: certificateId,
      before: diffable(row.snapshot as Certificate),
      after: diffable(merged),
    });

    return toRecord(updated);
  });
}

/**
 * A human signs off: the draft becomes an issued certificate.
 *
 * The caller renders the PDF and passes its digest, so what was approved and
 * what gets delivered are provably the same document. Also marks the originating
 * request `approved` — the request is done being worked, but nothing has been
 * sent; delivery stays a separate, explicit action.
 */
export async function approve(
  session: Session,
  certificateId: string,
  pdfSha256: string
): Promise<CertificateRecord> {
  return withTenant(session.tenantId, async (tx) => {
    const [row] = await tx.select().from(certificates).where(eq(certificates.id, certificateId));
    if (!row) throw new ServiceError("Certificate not found.", 404);
    if (row.status !== "draft") throw new ServiceError(`Certificate is already ${row.status}.`, 409);

    const [updated] = await tx
      .update(certificates)
      .set({
        status: "issued",
        approvedBy: session.userId,
        approvedAt: new Date(),
        pdfSha256,
      })
      .where(eq(certificates.id, certificateId))
      .returning();

    if (row.requestId) {
      await tx
        .update(coiRequests)
        .set({ status: "approved" })
        .where(eq(coiRequests.id, row.requestId));
    }

    await audit(tx, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "certificate.approved",
      subjectType: "certificate",
      subjectId: certificateId,
      after: { certificateNumber: row.certificateNumber, revision: row.revision, pdfSha256 },
    });

    return toRecord(updated);
  });
}

export async function getCertificate(
  session: Session,
  certificateId: string
): Promise<CertificateRecord> {
  return withTenant(session.tenantId, async (tx) => {
    const [row] = await tx.select().from(certificates).where(eq(certificates.id, certificateId));
    if (!row) throw new ServiceError("Certificate not found.", 404);
    return toRecord(row);
  });
}

/** Audit `before`/`after` hold shape, not content — see lib/audit.ts. */
function diffable(cert: Certificate) {
  return {
    insured: cert.insured?.name,
    holder: cert.holder?.name,
    descriptionLines: cert.descriptionOfOperations?.split("\n").length ?? 0,
    otherRows: cert.coverages?.other?.length ?? 0,
    remarkLines: cert.additionalRemarks?.length ?? 0,
  };
}

/** "MM/DD/YYYY" for today, UTC. Not used for policy dates — those come from
 *  the database as strings and never touch Date. */
function todayAcord(): string {
  const now = new Date();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${now.getUTCFullYear()}`;
}
