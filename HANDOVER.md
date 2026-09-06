# OPEN ISSUE — a requester's reply is sometimes not read

**Status:** unresolved. Linking is fixed; **reading the reply text is not.**
**Written:** 2026-08-27, at the end of a long session, before a context compact.
**Read this before touching `lib/matching/clarify.ts` or `identifier.ts`.**

---

## The symptom, in the user's words

> "the part from where the requester sends the MC number is still not working …
> it shows that the user sent the MC number however this does not trigger
> anything or matched this MC number with the company"

The user has now sent several ambiguous requests and replied with an MC number.
**Some resolve, some do not.** That inconsistency is the whole problem.

---

## Hard evidence — two requests, same sender, four minutes apart

From `coi_requests`, newest first:

```
12:55:01  Certificate of Insurance for Smartway Solutions
  from      f2021-597@bnu.edu.pk
  status    sent   client=SET   conf=requesterConfirmed
  certs     COI-2026-0014 / issued          <-- WORKED end to end

12:51:49  Certificate of Insurance for Smartway Solutions
  from      f2021-597@bnu.edu.pk
  status    needsMatch   client=null   conf=clarificationUnclear
  certs     none                            <-- FAILED
```

**`conf=clarificationUnclear` is the key.** That value is written in exactly one
place — `applyAnswer()` in `lib/matching/clarifyService.ts`, when
`readClarification()` returns `{ kind: "none" }`.

### What that proves

| Step | Working? | How we know |
|---|---|---|
| Reply reaches the mailbox | YES | it was processed |
| Reply linked to its request | **YES** | `applyAnswer` ran on the ORIGINAL request; a linking failure would have created a second request instead |
| Reply text read | **NO** | `clarificationUnclear` |
| Certificate drafted | n/a | never reached |

**So the reply-linking bugs are fixed. The remaining fault is in reading the
reply body.** Do not re-investigate linking — see "Already fixed" below.

---

## THE NEXT STEP — do this first

The reply body is **not stored anywhere**. A reply is linked to an existing
request rather than becoming one, so there is no row holding its text. That is
why this cannot be diagnosed from the database, and why the last session ran out
of context guessing.

**Logging has been added for exactly this.** In `applyAnswer()`, when the reader
returns nothing, it now prints:

```
[clarify] could not read an answer for request <id>: <reason>
[clarify]   raw reply : "<first 400 chars>"
[clarify]   candidates: Smart Way Solutions Inc | Smart Way Solutions LLC
```

### To reproduce and capture

1. `npm run dev` and `npm run watch` (two terminals)
2. Email the mailbox: `Please send a certificate of insurance for Smartway Solutions.`
3. Wait for the system's question to arrive
4. **Reply from the same mail client the user uses**, with an MC number
5. **Read the `npm run watch` terminal.** If it fails, the raw reply is printed
   there.

The printed `raw reply` is the missing input. Everything else follows from it.

### Leading hypotheses, in order

1. **HTML-only reply.** `bodyText()` in `lib/gmail/inbox.ts` strips HTML when
   there is no `text/plain` part. Gmail replies from some clients are HTML-only,
   and the stripper may be mangling the number or the whole body. **Check
   whether `raw reply` is empty or garbled — this is the most likely cause.**
2. **`stripQuotedReply()` eats the answer.** In `lib/matching/clarify.ts`. It
   cuts at the first `>`, `On … wrote:`, `From:` etc. If the client puts the
   quoted original ABOVE the reply (top-posting variants, or a mobile client),
   the answer is cut off and nothing readable remains.
3. **A phrasing the parser still misses.** Least likely now — the reader was
   rewritten this session and covers a lot (see below) — but the raw reply will
   say.

---

## What was already fixed this session (do not redo)

1. **`split(/s+/)` → `split(/\s+/)`** in `referencedIds()`, `lib/gmail/inbox.ts`.
   A lost backslash split Message-IDs on the letter "s", so replies never linked.
2. **`findRequestInThread()`** in `clarifyService.ts` — a reply is matched to its
   thread in ANY status, not only `awaitingRequester`. Previously, if a reviewer
   clicked "Identify anyway" while a reply was in flight, the reply became a
   duplicate request.
3. **The identifier reader was rewritten twice.** It now handles the company
   name sitting between the label and the number:
   - `the MC number for Smartway Solutions is :  1043790`
   - `MC# 1084463`, `MC No. 1084463`, `our MC is 1084463`, `MC1084463`
   - `1084463 is our MC number` (reversed)
   - `USDOT 3121884`, `D.O.T. 3121884`, `Our DOT number is 3121884`
   And still refuses: bare numbers, policy/invoice/phone numbers, anything
   after a sentence break, `dot` inside `dotted`.
   **59 checks in `npm run verify:clarify`.**
4. **`sendReply` refuses empty messages** — an empty body with no attachment
   now raises rather than sending.
5. **Mailbox moved** to `hasnaintesting72@gmail.com` with a new App Password.
   `npm run verify:mailbox` proves both directions, sends nothing.

---

## Where things are

| Concern | File |
|---|---|
| Read MC/DOT out of text | `lib/matching/identifier.ts` — `readIdentifiers()` |
| Decide what a reply means | `lib/matching/clarify.ts` — `readClarification()`, `stripQuotedReply()` |
| Apply an answer, draft the cert | `lib/matching/clarifyService.ts` — `applyAnswer()` |
| Link a reply to its request | `lib/matching/clarifyService.ts` — `findRequestInThread()` |
| Turn a raw email into text | `lib/gmail/inbox.ts` — `bodyText()`, `referencedIds()` |
| Where replies are handled | `lib/gmail/ingest.ts` — `handleIfReply()` |

### Tests

```
npm run verify:clarify   # 59 — reading identifiers and replies. PURE.
npm run verify:answer    # 33 — reply -> resolved -> certificate. Needs the DB.
npm run verify:mailbox   #  4 — credentials. Sends nothing.
```

`SEND_REAL_MAIL=1` is required by the three tests that send mail. **The user's
previous mailbox was filled to capacity by repeated test runs — do not remove
that guard, and do not run them casually.**

All suites pass: **253 checks**, `tsc` clean, `npm run build` clean.

**The passing tests are the problem.** `verify:answer` constructs its own reply
body in `replyBody()` and it reads fine. Whatever the user's real client sends
is different. Do not add more synthetic cases until the real `raw reply` is in
hand — that is what the last session got wrong, twice.

---

## The seeded data

Two deliberately near-identical companies, so ambiguity is demonstrable:

| Company | DOT | MC | Policies | Trucks |
|---|---|---|---|---|
| Smart Way Solutions **Inc** | 3121884 | 1084463 | 3 | 6 |
| Smart Way Solutions **LLC** | 2988014 | 1043790 | 2 | 2 |

A request naming "Smartway Solutions" fits both and must not resolve on its own.

`npm run db:seed` resets everything. **It deletes and recreates the tenant, so
restart `npm run watch` afterwards** — the watcher caches the tenant id and will
otherwise fail every ingest on a foreign key.

---

## Two recurring environment traps

1. **Port 3000 gets held by a stale process.** Symptom: `next dev` logs
   `EADDRINUSE` but something still answers on 3000 with 404s. Fix:
   `netstat -ano | grep :3000`, kill the PID, restart.
2. **Never run `npm run build` while `next dev` is running.** They share
   `.next` and the dev server starts serving 404s or `MODULE_NOT_FOUND`. Stop
   the dev server, `rm -rf .next`, build, then restart.
