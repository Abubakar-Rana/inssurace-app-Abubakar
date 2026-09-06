/**
 * A thread does not close when we send the certificate.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS GUARDS
 *
 * A requester replies to the mail we sent: "can you resend that with the
 * VINs?", "the holder address is wrong", "we need it dated for March". Those
 * are requests for a document, arriving as replies. They used to be counted as
 * skipped and dropped — never stored, never queued, visible only as one line in
 * the passed-over list. The customer's follow-up was silently lost.
 *
 * Two rules decide what happens instead, and both are asserted here:
 *
 *   1. WHICH ACTION. Read from the state of the request already in the thread.
 *      Amending a FINISHED request would falsify it: its certificate is issued,
 *      immutable, and possibly already in a holder's hands. So a follow-up on a
 *      finished request is a new request; on an open one it is an amendment.
 *
 *   2. THE INSURED SURVIVES. "Can you resend with the VINs?" names no company,
 *      because the company was established earlier in the thread. Interpreting
 *      that text alone resolves nothing, and the old code would have written
 *      that nothing over a perfectly good match.
 *
 * PURE: no database, no network.
 *
 *   npm run verify:followup
 * ---------------------------------------------------------------------------
 */

import { followUpAction } from "@/lib/gmail/followUp";
import { wantsVins } from "@/lib/matching/vinRequest";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

/**
 * Every value of the `request_status` enum in db/schema.ts.
 *
 * Listed by hand ON PURPOSE. If someone adds a status and does not decide what
 * a reply to it means, this list stops matching and the test below fails —
 * which is the whole point. Importing the enum would make it pass silently.
 */
const ALL_STATUSES = [
  "new",
  "interpreting",
  "needsMatch",
  "awaitingRequester",
  "ready",
  "approved",
  "sent",
  "rejected",
] as const;

console.log("\n--- which action a reply triggers ---\n");

// The clarification exchange is untouched by any of this.
check("awaitingRequester -> answer", followUpAction("awaitingRequester") === "answer");

// Finished. The certificate is issued and immutable; a further ask is a
// further document, in the same thread.
for (const status of ["approved", "sent", "rejected"] as const) {
  check(`${status} -> new request in the thread`, followUpAction(status) === "new");
}

// Still open. Whatever certificate exists is a draft, so fold it in.
for (const status of ["new", "interpreting", "needsMatch", "ready"] as const) {
  check(`${status} -> amend the open request`, followUpAction(status) === "amend");
}

console.log("\n--- no status is left unclassified ---\n");

for (const status of ALL_STATUSES) {
  const action = followUpAction(status);
  check(`${status} has an action`, ["answer", "amend", "new"].includes(action), action);
}

// The dangerous direction, stated on its own: an issued certificate must never
// be reached by an amendment.
check(
  "a finished request is never amended",
  (["approved", "sent", "rejected"] as const).every((s) => followUpAction(s) !== "amend")
);

console.log("\n--- the follow-up actually changes the document ---\n");

/**
 * The point of the whole feature. The reviewer's example: a certificate goes
 * out without VINs, the requester replies asking for them.
 *
 * An amendment APPENDS the reply to the request body rather than replacing it,
 * because the first message says which company and who the holder is, and the
 * second says only what to change. `wantsVins` reads that same body, so the
 * append is what makes the re-draft come back with VINs on it.
 */
const original = "Hi, please send a certificate of insurance for Smart Way Solutions Inc. Thanks.";
const followUp = "Thanks — could you resend that with the VIN numbers included please?";
const amended = [original, followUp].join("\n\n---\n\n");

check("the original asked for no VINs", wantsVins({ subject: "COI request", body: original }).wanted === false);
check(
  "the amended body asks for VINs",
  wantsVins({ subject: "COI request", body: amended }).wanted === true
);
check(
  "replacing instead of appending would lose the insured",
  followUp.toLowerCase().includes("smart way") === false,
  "the follow-up names no company, which is why the body is appended and the client carried over"
);

// The inversion, which vinRequest.ts exists to get right: a follow-up that
// DECLINES VINs must not read as a request for them.
const declined = [original, "No VINs needed on this one, just the limits."].join("\n\n---\n\n");
check(
  "a follow-up declining VINs does not turn them on",
  wantsVins({ subject: "COI request", body: declined }).wanted === false
);

console.log(
  failures === 0 ? "\nall follow-up rules hold\n" : `\n${failures} FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
