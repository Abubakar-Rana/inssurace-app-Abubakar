/**
 * What a reply in a thread we already know about should do.
 *
 * ---------------------------------------------------------------------------
 * A THREAD DOES NOT CLOSE WHEN WE SEND THE CERTIFICATE.
 *
 * "Can you resend that with the VINs?", "the holder address is wrong", "we need
 * it dated for March" — all arrive as replies to the mail we sent, and all are
 * requests for a document. Treating them as correspondence dropped them: never
 * stored, never queued, visible only as one line in the passed-over list.
 *
 * The decision is read from the STATE of the request already in the thread,
 * because that is what says whether there is still something to change.
 *
 * Pure and dependency-free on purpose — the rule is worth testing on its own,
 * and importing it should never pull in a database connection.
 * ---------------------------------------------------------------------------
 */

export type FollowUpAction =
  /** The reply answers the question we asked about which insured was meant. */
  | "answer"
  /** Fold it into the open request and re-draft: its certificate is a draft. */
  | "amend"
  /** Start a new request in the same thread: the earlier one is finished. */
  | "new";

/**
 * Total over the `request_status` enum in db/schema.ts.
 *
 * A status added later that nobody classified would fall through to "amend",
 * and amending a finished request is the one outcome that would falsify a
 * record — its certificate is issued, immutable, and may already be in a
 * holder's hands. `npm run verify:followup` asserts every status is decided.
 */
export function followUpAction(status: string): FollowUpAction {
  if (status === "awaitingRequester") return "answer";

  // Finished. The ask really was fulfilled and its certificate cannot change,
  // so a further ask is a further document that happens to share a thread.
  if (status === "approved" || status === "sent" || status === "rejected") return "new";

  // Still open — new, interpreting, needsMatch, ready. Whatever certificate
  // exists is a draft, so the new instruction can simply be folded in.
  return "amend";
}
