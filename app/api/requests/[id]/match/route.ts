/**
 * GET   /api/requests/:id/match — what the machine saw, for a human to judge
 * POST  /api/requests/:id/match — a human assigns the insured
 *
 * This is the escape hatch for every case the resolver refuses. The refusals
 * are correct — a near-tie between two related companies must not be settled by
 * a coin flip — but they are only useful if a person can then settle it, so
 * this route exists to make abstention a pause rather than a dead end.
 */

import { eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { clients, coiRequests } from "@/db/schema";
import { audit } from "@/lib/audit";
import { json, readJson, route } from "@/lib/api";
import { requireWrite } from "@/lib/auth/session";
import { generateDraft, ServiceError } from "@/lib/certificate/service";
import { interpret } from "@/lib/matching/interpret";

export const dynamic = "force-dynamic";

/** Re-run interpretation read-only, so the reviewer sees the same evidence. */
export const GET = route<{ id: string }>(async (session, _req, { params }) => {
  const request = await withTenant(session.tenantId, async (tx) => {
    const [row] = await tx.select().from(coiRequests).where(eq(coiRequests.id, params.id));
    return row;
  });
  if (!request) throw new ServiceError("Request not found.", 404);

  const result = await interpret(session.tenantId, {
    subject: request.subject,
    body: request.bodyText,
  });

  return json({
    request: {
      id: request.id,
      subject: request.subject,
      fromAddr: request.fromAddr,
      fromName: request.fromName,
      bodyText: request.bodyText,
      status: request.status,
      clientId: request.clientId,
    },
    interpretation: {
      decision: result.decision,
      reason: result.reason,
      extracted: result.extracted,
      candidates: result.candidates,
    },
  });
});

export const POST = route<{ id: string }>(async (session, req, { params }) => {
  requireWrite(session);

  const body = await readJson<{ clientId?: string }>(req);
  if (!body.clientId) throw new ServiceError("Expected a `clientId`.", 400);

  const matched = await withTenant(session.tenantId, async (tx) => {
    const [request] = await tx.select().from(coiRequests).where(eq(coiRequests.id, params.id));
    if (!request) throw new ServiceError("Request not found.", 404);

    if (request.status === "sent" || request.status === "approved") {
      throw new ServiceError(
        `This request is ${request.status}; re-assigning the insured now would not change the ` +
          `certificate that was already issued.`,
        409
      );
    }

    // RLS scopes this, so a client id from another tenant simply isn't found.
    const [client] = await tx.select().from(clients).where(eq(clients.id, body.clientId!));
    if (!client) throw new ServiceError("No such client.", 404);

    await tx
      .update(coiRequests)
      .set({ clientId: client.id, status: "ready", matchConfidence: "manual" })
      .where(eq(coiRequests.id, params.id));

    // Worth auditing precisely because it overrides the machine: if a wrong
    // certificate is ever issued, this records who chose the insured.
    await audit(tx, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "request.matched_manually",
      subjectType: "coi_request",
      subjectId: params.id,
      before: { clientId: request.clientId, status: request.status },
      after: { clientId: client.id, status: "ready", legalName: client.legalName },
    });

    return { clientId: client.id, legalName: client.legalName, status: "ready" };
  });

  // Draft it now, exactly as polling would have if the resolver had been sure.
  // Identifying the insured was the only judgement missing; making the reviewer
  // then ask for the document would be a second click for no second decision.
  //
  // Outside the transaction above on purpose: generateDraft opens its own, and
  // a nested one takes a different pooled connection that would deadlock
  // against locks the first still holds.
  let certificate: { id: string; certificateNumber: string } | null = null;
  try {
    const draft = await generateDraft(
      { tenantId: session.tenantId, actorUserId: session.userId, authorizedRep: session.email },
      params.id
    );
    certificate = { id: draft.id, certificateNumber: draft.certificateNumber };
  } catch {
    // The match itself succeeded and is what the reviewer asked for. A drafting
    // failure leaves them on a matched request they can retry, not an error
    // that makes it look as though nothing happened.
  }

  return json({ ...matched, certificate });
});
