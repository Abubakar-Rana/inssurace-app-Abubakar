/**
 * Read an inbound request and decide which insured it is for.
 *
 * This is the whole interpretation step: extract candidate names from the
 * email (lib/matching/extract.ts), resolve each against the client list
 * (lib/matching/resolve.ts), and record the outcome on the request.
 *
 * The division of labour is the safety property. Interpretation may only ever
 * choose a `clientId` — it cannot supply a policy number, a limit, a date, or
 * any other certificate value, because it has nowhere to put one. Everything
 * printed on the document is read from the client's own records afterwards. A
 * wrong answer here means a human sees the wrong company on screen and rejects
 * it; it can never mean a certificate quietly states coverage that does not
 * exist.
 *
 * The LLM reader (lib/llm/insured.ts) plugs in at exactly that first line. It
 * may only propose NAMES and federal numbers that appear verbatim in the email
 * — its own guards enforce that — and every one of them still has to resolve
 * against the agency's own client list before it means anything. So the model
 * widens what can be READ; it cannot widen what can be PRINTED.
 */

import { eq } from "drizzle-orm";
import { withTenant, type TenantDb } from "@/lib/db/client";
import { coiRequests } from "@/db/schema";
import { audit } from "@/lib/audit";
import { extractInsuredNames, type EmailInput, type Extraction } from "./extract";
import { resolveClient, type Candidate, type MatchDecision } from "./resolve";
import { resolveByIdentifier, type Identifiers } from "./identifier";
import { llmMode } from "@/lib/llm/config";
import { llmModel } from "@/lib/llm/config";
import { insuredText, readInsuredWithLlm } from "@/lib/llm/insured";
import { recordReading, withReadingContext, type ReadingOutcome } from "@/lib/llm/readingLog";

export interface Interpretation {
  decision: MatchDecision;
  clientId: string | null;
  clientName: string | null;
  /** The name from the email that produced the decision. */
  usedName: string | null;
  /** Every name the extractor proposed, best phrasing first. */
  extracted: Extraction[];
  /** Client records considered, for a human resolving an ambiguous result. */
  candidates: Candidate[];
  reason: string;
}

/**
 * Ask the model who the certificate is for, when LLM_READING enables it.
 *
 * Never throws and never blocks the decision: a refusal, a timeout or a missing
 * key leaves the pattern reading exactly as it was. In shadow mode the answer
 * is recorded and then ignored.
 */
async function readWithModel(
  email: EmailInput,
  patternNames: Extraction[]
): Promise<{ names: Extraction[]; identifiers: Identifiers; record: () => void }> {
  const mode = llmMode("extract");
  const patternSummary = patternNames.map((n) => n.name).join(", ") || "(no name)";
  const nothing = { names: [], identifiers: {} as Identifiers, record: () => {} };
  if (mode === "off") return nothing;

  const reading = await readInsuredWithLlm(insuredText(email));
  if (!reading.reached) return nothing; // the model was not reached; heuristic stands

  if (!reading.verdict.ok) {
    const reason = reading.verdict.reason;
    return {
      ...nothing,
      record: () =>
        recordReading({ reader: "extract", mode, pattern: patternSummary, model: llmModel(), outcome: "refused", note: reason }),
    };
  }

  const { names, identifiers, dropped } = reading.verdict;
  const same =
    names.length === patternNames.length &&
    names.every((n) => patternNames.some((p) => p.name.toLowerCase() === n.name.toLowerCase()));

  return {
    // Shadow mode reads, records and changes nothing.
    names: mode === "live" ? names : [],
    identifiers: mode === "live" ? identifiers : {},
    record: () =>
      recordReading({
        reader: "extract",
        mode,
        pattern: patternSummary,
        model: llmModel(),
        outcome: (same ? "agreed" : mode === "live" ? "used" : "not used") as ReadingOutcome,
        note: [names.map((n) => n.name).join(", ") || "(no name)", dropped.length ? `dropped: ${dropped.join("; ")}` : ""]
          .filter(Boolean)
          .join(" | "),
      }),
  };
}

/** Pure: text in, decision out. No writes — see `interpretRequest` for those. */
export async function interpret(
  tenantId: string,
  email: EmailInput,
  tx?: TenantDb
): Promise<Interpretation> {
  const patternNames = extractInsuredNames(email);
  const model = await readWithModel(email, patternNames);
  model.record();

  /**
   * A federal number beats every name, from either reader: names are not
   * unique and USDOT/MC numbers are. It matches one client exactly or not at
   * all — there is no fuzzy matching on an identifier.
   */
  if (model.identifiers.dot || model.identifiers.mc) {
    const byNumber = await resolveByIdentifier(tenantId, model.identifiers, tx);
    if (byNumber) {
      return {
        decision: "matched",
        clientId: byNumber.clientId,
        clientName: byNumber.legalName,
        usedName: byNumber.legalName,
        extracted: [...model.names, ...patternNames],
        candidates: [],
        reason: `The email gives a ${byNumber.matchedOn === "dot" ? "USDOT" : "MC"} number, which belongs to ${byNumber.legalName}.`,
      };
    }
  }

  // The model's names first: they are read from the whole sentence rather than
  // a fixed phrasing, and each one was checked to appear in the email verbatim.
  const extracted: Extraction[] = [...model.names];
  for (const candidate of patternNames) {
    if (!extracted.some((e) => e.name.toLowerCase() === candidate.name.toLowerCase())) extracted.push(candidate);
  }

  if (!extracted.length) {
    return {
      decision: "noMatch",
      clientId: null,
      clientName: null,
      usedName: null,
      extracted: [],
      candidates: [],
      reason: "The email does not say which company the certificate is for.",
    };
  }

  // Try candidates in order of how explicitly the email named them. The first
  // confident match wins; a weaker phrasing never overrides a stronger one.
  let bestAmbiguous: Interpretation | null = null;

  for (const candidate of extracted) {
    const resolved = await resolveClient(tenantId, candidate.name, tx);

    if (resolved.decision === "matched" && resolved.client) {
      return {
        decision: "matched",
        clientId: resolved.client.clientId,
        clientName: resolved.client.legalName,
        usedName: candidate.name,
        extracted,
        candidates: resolved.candidates,
        reason: `Read "${candidate.name}" from the ${candidate.source} phrasing. ${resolved.reason}`,
      };
    }

    // Hold the first ambiguous result: it is more useful to a reviewer than a
    // bare "no match", because it names the records worth choosing between.
    if (resolved.decision === "ambiguous" && !bestAmbiguous) {
      bestAmbiguous = {
        decision: "ambiguous",
        clientId: null,
        clientName: null,
        usedName: candidate.name,
        extracted,
        candidates: resolved.candidates,
        reason: `Read "${candidate.name}" from the email, but ${resolved.reason}`,
      };
    }
  }

  if (bestAmbiguous) return bestAmbiguous;

  return {
    decision: "noMatch",
    clientId: null,
    clientName: null,
    usedName: extracted[0].name,
    extracted,
    candidates: [],
    reason: `Read "${extracted[0].name}" from the email, but no client resembles it.`,
  };
}

/**
 * Interpret a stored request and write the outcome back.
 *
 * `matched` advances the request to `ready` and links the client; anything else
 * parks it at `needsMatch` for a human. Nothing is deleted or overwritten
 * destructively — a re-run simply re-decides.
 */
export async function interpretRequest(
  tenantId: string,
  requestId: string,
  actorUserId: string | null = null
): Promise<Interpretation> {
  return withTenant(tenantId, async (tx) => {
    const [request] = await tx.select().from(coiRequests).where(eq(coiRequests.id, requestId));
    if (!request) throw new Error(`Request ${requestId} not found for this tenant.`);

    // Ids for any reading taken below, so a disagreement can be traced back to
    // the request and the message it came from.
    const result = await withReadingContext(
      { tenantId, requestId, messageId: request.gmailMessageId },
      () => interpret(tenantId, { subject: request.subject, body: request.bodyText }, tx)
    );

    /**
     * A follow-up does not un-identify an insured.
     *
     * "Can you resend that with the VINs?" names no company, because the
     * company was established earlier in the thread. Interpreting that on its
     * own resolves nothing — so if this request already carries a client and
     * the text names none, the existing one stands. Only a text that actually
     * resolves to a company can change it.
     *
     * For a first request `clientId` is null, so this changes nothing there.
     */
    const clientId = result.clientId ?? request.clientId ?? null;
    const decided = clientId ? "ready" : "needsMatch";

    await tx
      .update(coiRequests)
      .set({
        clientId,
        status: decided,
        // The confidence describes THIS reading. Saying "matched" because an
        // earlier message in the thread matched would overstate it.
        matchConfidence: result.clientId ? result.decision : (request.matchConfidence ?? result.decision),
      })
      .where(eq(coiRequests.id, requestId));

    // Records the decision and the evidence, never the email body — the body is
    // purged on the L6 schedule and must not be copied into an immutable log.
    await audit(tx, {
      tenantId,
      actorUserId,
      action: "request.interpreted",
      subjectType: "coi_request",
      subjectId: requestId,
      before: { status: request.status, clientId: request.clientId },
      // What was actually written, not what this reading alone concluded — an
      // audit entry that disagrees with the row it describes is worse than none.
      after: {
        status: decided,
        clientId,
        usedName: result.usedName,
        keptEarlierClient: !result.clientId && Boolean(request.clientId),
        method: llmMode("extract") === "live" ? "heuristic + model" : "heuristic",
      },
    });

    return result;
  });
}
