/**
 * Auto-send: issue and email a drafted certificate with no reviewer.
 *
 * OFF unless the agency turned it on (tenants.auto_send). When off — the
 * default — this does nothing, and the lifecycle is exactly as before: a human
 * approves, a human sends.
 *
 * When on, it runs ONLY for requests the system is sure about:
 *   matched            the resolver found one client by a clear margin
 *   requesterConfirmed the requester named the company by exact USDOT/MC
 * Anything ambiguous, unmatched, or matched by a person still waits for a
 * reviewer — auto-send never turns a guess into a delivered document.
 *
 * It reuses the normal approve + deliver path, so every guard those enforce
 * still applies: drafts only, PDF hash recorded at approval and re-checked
 * before sending, reserved/demo domains refused, send-before-record. The audit
 * trail records the actor as the system (null) plus an explicit
 * `certificate.auto_issued` entry, so nobody later mistakes it for a person's
 * decision.
 *
 * Never throws. A failure leaves the certificate for a reviewer, as if
 * auto-send were off.
 */

import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { certificates, coiRequests, tenants } from "@/db/schema";
import { audit } from "@/lib/audit";
import { publish } from "@/lib/events";
import type { Session } from "@/lib/auth/session";
import { approve } from "./service";
import { deliverCertificate } from "./deliver";
import { renderCertificatePdf, sha256 } from "./render";

const CONFIDENT = new Set(["matched", "requesterConfirmed"]);

export type AutoSendResult = { sent: true; to: string } | { sent: false; reason: string; flagged?: boolean };

/**
 * Record why this request was not sent automatically, so the inbox can show it.
 *
 * Only reasons the agency can act on are flagged. "Auto-send is off" and "no
 * draft yet" are the system working normally, and flagging those would put a
 * warning on every row of a manual agency's inbox.
 */
async function flag(tenantId: string, requestId: string, reason: string | null): Promise<void> {
  try {
    await withTenant(tenantId, (tx) =>
      tx
        .update(coiRequests)
        .set({ autoSendError: reason, autoSendAt: new Date() })
        .where(eq(coiRequests.id, requestId))
    );
  } catch (err) {
    console.warn(`[auto-send] could not flag request ${requestId}: ${(err as Error).message}`);
  }
}

/**
 * Tell any open dashboard how this ended.
 *
 * An agency on auto-send is not watching the queue, so the two things it must
 * still learn are "one went out" and "one did not". The event carries the
 * request id and nothing else - the toast text is built from the row the
 * dashboard re-fetches through the normal authenticated route.
 */
function announce(tenantId: string, requestId: string, sent: boolean): void {
  try {
    publish(tenantId, {
      type: sent ? "certificate.autoSent" : "certificate.autoSendFailed",
      requestId,
      at: new Date().toISOString(),
    });
  } catch (err) {
    // A notification must never fail the work that caused it. The certificate
    // is already sent (or already flagged on the row) either way.
    console.warn("[auto-send] could not announce " + requestId + ": " + (err as Error).message);
  }
}

export async function maybeAutoSend(tenantId: string, requestId: string): Promise<AutoSendResult> {
  try {
    const found = await withTenant(tenantId, async (tx) => {
      const [tenant] = await tx.select({ autoSend: tenants.autoSend, name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
      if (!tenant?.autoSend) return { skip: "auto-send is off" };

      const [request] = await tx.select().from(coiRequests).where(eq(coiRequests.id, requestId));
      if (!request?.clientId) return { skip: "request is not matched" };
      if (!CONFIDENT.has(request.matchConfidence ?? "")) {
        // Not a failure: an uncertain match is exactly what a person is for.
        return { skip: `match is "${request.matchConfidence}", which needs a reviewer` };
      }

      // ONE AUTOMATIC DOCUMENT PER REQUEST.
      //
      // If something already went out for this request, nothing here may
      // send a second one - whatever put another draft in front of us (a
      // re-ingested email, a re-interpretation, two pollers) must not turn
      // into a second certificate in the requester's inbox. A genuine
      // second ask arrives as its OWN request (see followUp.ts), so this
      // never blocks real work, and a reviewer can still issue a revision
      // by hand - that is a person's decision, which is the whole point.
      const [alreadyIssued] = await tx
        .select({ number: certificates.certificateNumber, status: certificates.status })
        .from(certificates)
        .where(
          and(
            eq(certificates.requestId, requestId),
            // Anything past draft: issued, sent, or issued and later voided.
            ne(certificates.status, "draft")
          )
        )
        .limit(1);
      if (alreadyIssued) {
        return {
          skip: `${alreadyIssued.number} has already been issued for this request (${alreadyIssued.status})`,
        };
      }

      const [draft] = await tx
        .select({ id: certificates.id })
        .from(certificates)
        .where(and(eq(certificates.requestId, requestId), eq(certificates.status, "draft")))
        .orderBy(desc(certificates.revision))
        .limit(1);
      if (!draft) {
        // Matched, auto-send on, and still no document: the assembler could not
        // build one (usually no active policy for that insured). That IS the
        // agency's to fix, so it is flagged rather than skipped quietly.
        return { needsReview: "Could not prepare a certificate — check this insured has an active policy." };
      }
      return { certificateId: draft.id, tenantName: tenant.name, matchConfidence: request.matchConfidence };
    });

    if ("skip" in found) return { sent: false, reason: found.skip! };
    if ("needsReview" in found) {
      await flag(tenantId, requestId, found.needsReview!);
      announce(tenantId, requestId, false);
      return { sent: false, reason: found.needsReview!, flagged: true };
    }

    // The system acts as itself: no user id, so approvedBy / sentBy stay null
    // and the audit log shows no person behind it.
    const system = {
      tenantId,
      tenantSlug: "",
      tenantName: found.tenantName,
      userId: null,
      email: "system",
      name: "CertFlow auto-send",
      role: "admin",
      mustChangePassword: false,
      canManageUsers: false,
    } as unknown as Session;

    const record = await withTenant(tenantId, async (tx) => {
      const [row] = await tx.select().from(certificates).where(eq(certificates.id, found.certificateId!));
      return row;
    });
    const bytes = await renderCertificatePdf(record.snapshot as never);
    await approve(system, found.certificateId!, sha256(bytes));

    await withTenant(tenantId, (tx) =>
      audit(tx, {
        tenantId,
        actorUserId: null,
        action: "certificate.auto_issued",
        subjectType: "certificate",
        subjectId: found.certificateId!,
        after: { requestId, matchConfidence: found.matchConfidence, reason: "agency auto-send enabled" },
      })
    );

    const delivered = await deliverCertificate(system, found.certificateId!);
    console.log(`[auto-send] ${tenantId}: ${delivered.certificateNumber} sent to ${delivered.to}`);
    await flag(tenantId, requestId, null); // cleared: it went out
    announce(tenantId, requestId, true);
    return { sent: true, to: delivered.to };
  } catch (err) {
    const reason = (err as Error).message;
    console.warn(`[auto-send] request ${requestId}: ${reason} — left for a reviewer`);
    await flag(tenantId, requestId, reason);
    announce(tenantId, requestId, false);
    return { sent: false, reason, flagged: true };
  }
}
