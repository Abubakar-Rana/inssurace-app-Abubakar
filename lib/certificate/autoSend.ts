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

import { and, desc, eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { certificates, coiRequests, tenants } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { Session } from "@/lib/auth/session";
import { approve } from "./service";
import { deliverCertificate } from "./deliver";
import { renderCertificatePdf, sha256 } from "./render";

const CONFIDENT = new Set(["matched", "requesterConfirmed"]);

export type AutoSendResult = { sent: true; to: string } | { sent: false; reason: string };

export async function maybeAutoSend(tenantId: string, requestId: string): Promise<AutoSendResult> {
  try {
    const found = await withTenant(tenantId, async (tx) => {
      const [tenant] = await tx.select({ autoSend: tenants.autoSend, name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
      if (!tenant?.autoSend) return { skip: "auto-send is off" };

      const [request] = await tx.select().from(coiRequests).where(eq(coiRequests.id, requestId));
      if (!request?.clientId) return { skip: "request is not matched" };
      if (!CONFIDENT.has(request.matchConfidence ?? "")) {
        return { skip: `match is "${request.matchConfidence}", which needs a reviewer` };
      }

      const [draft] = await tx
        .select({ id: certificates.id })
        .from(certificates)
        .where(and(eq(certificates.requestId, requestId), eq(certificates.status, "draft")))
        .orderBy(desc(certificates.revision))
        .limit(1);
      if (!draft) return { skip: "no draft to issue" };
      return { certificateId: draft.id, tenantName: tenant.name, matchConfidence: request.matchConfidence };
    });

    if ("skip" in found) return { sent: false, reason: found.skip! };

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
    return { sent: true, to: delivered.to };
  } catch (err) {
    const reason = (err as Error).message;
    console.warn(`[auto-send] request ${requestId}: ${reason} — left for a reviewer`);
    return { sent: false, reason };
  }
}
