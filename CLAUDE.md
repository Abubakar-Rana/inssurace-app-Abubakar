# CertFlow — ACORD 25 Certificate of Insurance Automation

> **OPEN ISSUE — READ [HANDOVER.md](HANDOVER.md) FIRST.**
> A requester reply carrying an MC number is sometimes not read
> (`match_confidence = clarificationUnclear`). Linking is fixed; READING the
> reply body is not. Logging has been added to capture the raw reply — reproduce
> it and read the `npm run watch` terminal before changing any parser.

Next.js 14 prototype for **Nestnic Solutions**. Simulates an inbound COI-request
email, matches the insured in AMS360, and auto-fills a pixel-perfect **ACORD 25
(2025/12)** certificate that the user can edit and distribute.

> **STATUS — the product is mid-migration from prototype to real system.**
> Target design lives in [ARCHITECTURE.md](ARCHITECTURE.md); read it first.
>
> **Done:** Postgres (Supabase) with 15 tables + row-level security; envelope
> encryption (`lib/crypto/envelope.ts`); deterministic assembler
> (`lib/certificate/assemble.ts` + `load.ts`) verified 17/17 against
> `COI_TRUCK_SOLUTION.PDF` via `npm run verify`.
> TypeScript added for backend code (`tsconfig.json`; `jsconfig.json` removed).
> Next.js pinned to **14.2.35** (14.2.5 had a CVE).
>
> **`npm run proof` regenerates the whole demo** — verifies the 17 fields, renders
> `out/certificate.pdf`, and rasterises both pages to PNG. Output is a two-page
> document that matches the sample field for field, including which vehicle
> stays on page 1 and which five move to the ACORD 101.
>
> Also done: `coverages.other` is an ARRAY rendered as 3 free rows; real
> width-aware line breaking (`lib/certificate/text.ts` + `fontMetrics.ts`) so the
> page-1 / ACORD-101 split is computed from wrapped lines, not logical ones;
> ACORD 101 page 2 in both renderers (`lib/acord101Map.js`);
> `vehicles.sortOrder` so fleets print in schedule order.
>
> Also done: **API routes + the dashboard now run on Postgres.** `lib/store.js`
> is a cache over `/api/*`; localStorage is gone. Certificate lifecycle
> (`lib/certificate/service.ts`) is draft → issued, with hash-chained audit
> entries (`lib/audit.ts`), revisions instead of mutation, and deterministic PDF
> bytes so `pdfSha256` survives a reprint. `npm run verify:api` proves it.
>
> Also done: **authentication (Security L3).** Signed session cookies
> (`lib/auth/cookie.ts`, Web Crypto so middleware can use it), OIDC sign-in
> (`lib/auth/oidc.ts`), `middleware.ts` gating pages, sign-out, and a
> cross-origin check on writes. Verified: unauthenticated → 401, forged cookie →
> 401, cross-origin write → 403, suspended account → 401 **on the existing
> cookie**.
>
> Also done: **browser test** (`npm run verify:ui`, 26 checks in real Chrome).
> It found three bugs that API-level testing could not: an infinite
> /signin redirect loop, a store that never re-fetched after client-side
> sign-in navigation, and a CSRF origin check pinned to `APP_URL` that rejected
> every legitimate write on any other host or port. All fixed.
>
> Also done: `policies.operationsNote` — free text for DESCRIPTION OF
> OPERATIONS, printed verbatim above the fleet. The towing sentence now comes
> from the database, so **the live app and `npm run proof` produce the same
> document**, matching the sample's 1-on-page-1 / 5-on-the-101 split.
>
> Also done: **entity resolution** (`lib/matching/resolve.ts`, no AI). pg_trgm
> over `clients.legal_name` + `client_aliases.alias`, with suffix-aware
> normalisation. It ABSTAINS by design — `matched` requires a strong score AND
> a clear margin over the runner-up, so two related entities route to a human
> instead of a coin flip. `npm run verify:matching` (22 checks, half of them
> asserting refusal).
>
> Also done: **email → insured interpretation, heuristic (no AI).**
> `lib/matching/extract.ts` pulls candidate names out of an email;
> `lib/matching/interpret.ts` resolves them and writes the outcome to the
> request (`ready` when matched, `needsMatch` otherwise) with an audit entry.
> `npm run verify:extraction` is pure and needs no database.
> The seeded inbox (`db/seed.ts` → `INBOX`) is 5 realistic emails, two of which
> the system must refuse. An LLM can replace `extract.ts` alone later — the
> contract is "text in, candidate names out".
>
> Also done: **Gmail ingestion over IMAP** (`lib/gmail/`). App Password, no
> Google Cloud project. The mailbox is opened `readOnly` so polling can never
> mark, move, or delete mail; de-duplication is the unique index on (tenant,
> gmailMessageId), not the \Seen flag, so `npm run gmail:poll` is safe to re-run.
> Bodies are stored with `purgeAfter` (30 days) and never enter the audit log.
> `npm run purge:ingested` removes ingested mail on demand.
>
> **App Passwords are phase 1 only.** They grant full read+send on the whole
> account and cannot be scoped or revoked per integration — fine for a mailbox
> we own, never for a customer's. Production is per-tenant OAuth with
> `gmail.readonly`; the seam is `lib/gmail/inbox.ts` alone.
>
> Also done: **delivery.** `lib/certificate/deliver.ts` + `lib/gmail/send.ts`
> reply IN THE ORIGINAL THREAD (`In-Reply-To` + `References` + `Re:`) with the
> PDF attached, record a `deliveries` row, and mark the request `sent`.
> `npm run verify:delivery:live` proves the whole chain against the real
> mailbox: email in → insured identified → certificate assembled → issued →
> replied in-thread.
>
> **Delivery refuses by default.** Drafts, malformed addresses, reserved demo
> domains (`.example`/`.invalid`/`.test`), and — outside production — anything
> that is not `GMAIL_USER` unless `DELIVERY_ALLOWLIST` says otherwise. This is
> what stops a click on seeded data emailing a real company.
> `components/DistributeModal.js` stays parked; the flow lives on the
> certificate page instead.
>
> Also done: **the UI gaps.** "Check for new email" button (`POST
> /api/gmail/poll`, which also sweeps any request still at `new`); a match
> dialog (`components/MatchModal.js`) that shows what the extractor read and why
> it stopped, so abstention is a pause rather than a dead end; a real
> `/certificates` page; dead prototype nav links removed. `npm run db:seed` now
> interprets what it seeds, so the inbox opens in a post-poll state (3 matched,
> 2 needing a human). 36 browser checks.
>
> Also done: **the mailbox filter** (`lib/gmail/classify.ts`). A shared agency
> inbox is mostly not COI requests, so classification runs BEFORE the insert and
> non-requests are never stored at all — the cheapest answer to "what did you do
> with my email?" is "we never kept it". Precision over recall, with the misses
> visible: every skipped subject and the reason comes back in the poll result and
> is shown on the dashboard, so a wrong skip is reviewable rather than silent.
> `GMAIL_INGEST_ALL=1` turns the filter off for debugging.
> `npm run verify:classify` is pure — 16 checks, 9 of them asserting refusal.
>
> Also done: **`DELIVERY_ALLOWLIST=*`** — reply to whatever address a request
> came from. An agency taking real requests cannot enumerate its requesters in
> advance, so `*` is the working configuration; the reserved-domain block is
> separate from the allowlist and still refuses seeded `.example` rows.
>
> Also done: **drafting is automatic.** The moment a request resolves to an
> insured — during polling, or when a human identifies it — the certificate is
> assembled. The reviewer's job is to CHECK a document, not to ask for one, so
> the inbox offers **Review certificate**, and `components/ProcessingModal.js`
> (the animated fake pipeline) is deleted. Nothing about the lifecycle changed:
> a draft is still only a draft, and issuing and sending are still human acts.
>
> Also done: **the certificate holder is read from the email**
> (`lib/matching/holder.ts`). It is the one field that cannot come from the
> agency's records — the holder is whoever wrote in, and the agency has no row
> for them until they do. It reads the signature block, which is exactly the
> region `extract.ts` discards, so the two are mirror images:
> above the sign-off is who the certificate is FOR, below it is who is ASKING.
> `npm run verify:holder` — 12 checks, including that neither reader can see
> the other's text.
>
> Also done (SUPERSEDED by the push design below, kept for the history): the
> dashboard used to poll the mailbox itself on a browser timer, which brought
> end-to-end latency from "whenever someone clicks" down to ~21s. That timer is
> gone; a server-side watcher and a live feed replaced it.
>
> Also done: **the dashboard is push-driven.** The old poll button and the
> browser timer are gone. `lib/gmail/watcher.ts` holds ONE IMAP connection open,
> reacts to the server's own new-mail announcement (IDLE) and re-checks that
> connection every `GMAIL_CHECK_SECONDS` (2) as a guarantee; changes reach the
> browser over Server-Sent Events (`app/api/events/route.ts`). Nothing reloads.
> Measured ~7-8s from a message landing in the mailbox to appearing on screen,
> of which ~4s is the ingest itself. `npm run verify:autopoll` reports the
> Gmail-delivery half and the detection half separately, because only the second
> is ours.
>
> The watcher runs as its own process — `npm run watch` — because a long-lived
> IMAP connection is a worker concern and Next.js cannot cleanly start one at
> boot (its instrumentation hook is compiled for the Edge runtime too, where
> there are no sockets). The web server also starts one lazily when a dashboard
> connects, so a single `npm run dev` still works; set `GMAIL_WATCH=0` on the web
> process to leave the job to the worker.
>
> Because those are two processes, `lib/events.ts` publishes over **Postgres
> LISTEN/NOTIFY** rather than an in-memory emitter — otherwise a browser attached
> to the web server would never hear about mail the worker ingested. The payload
> is only "something changed"; the dashboard re-fetches through the normal
> authenticated route.
>
> The top bar now shows an **unread count** (`coi_requests.viewed_at`, set when a
> reviewer opens a request) and whether the live feed is connected.
>
> Also done: **the system asks the requester when two clients are too alike.**
> `lib/matching/clarify.ts` composes the question, `clarifyService.ts` sends it
> in-thread and reads the answer, `identifier.ts` resolves a USDOT or MC number
> to exactly one client. The request parks at `awaitingRequester` until the reply
> arrives. **This is the only mail the system sends without a human** — it
> carries no coverage, no limits and no document, and `GMAIL_CLARIFY=0` turns it
> off. `npm run verify:clarify` (30 checks) and `npm run verify:clarify:live`.
>
> The seed now carries TWO near-identically named companies with different
> policies and different federal numbers, because with one client the resolver
> looked infallible and none of the above was demonstrable.
>
> Also done: **VINs are printed only when the request asks for them.**
> `lib/matching/vinRequest.ts`. A fleet schedule with VINs is an inventory of the
> insured's rolling stock; most requests do not need one, so silence means "leave
> them out". `npm run verify:vin` — 23 checks, including the inversions
> ("no VINs needed" must not read as a request for VINs).
>
> **Next:** hardening — rate limiting, a scheduled purge job reading
> `purge_after`, an audit-log viewer, and Layer 8 (vendor/subprocessor) docs.
>
> **Before deploy:** set `OIDC_*`. Without it sign-in falls back to a
> development path that is refused when `NODE_ENV=production` — so a missing
> config locks everyone out rather than letting anyone in.
>
> **Stack decision:** stay on Next.js/TypeScript. Spring Boot was evaluated and
> deferred — business logic is kept framework-free so a later port stays cheap.
>
> Sections below still describe the **original prototype** and are accurate for
> the UI layer only.

> **SaaS layer (2026-09-21, branch feature/saas-multitenant).** Many agencies on
> one deployment. Additive only — the email → match → draft → send pipeline is
> unchanged; each agency just gets its own mailbox and data source.
>
> - **Login:** email + password (`app/api/auth/login`, scrypt in
>   `lib/auth/password.ts`, 5-strike lockout, temporary passwords that must be
>   changed — `route()` in `lib/api.ts` refuses everything else until then) AND
>   the existing OIDC. Users are never self-registered.
> - **Nestnic console** `/admin`: separate table (`platform_admins`), separate
>   cookie bound by `aud: "platform"` (`lib/auth/platform.ts`). Creates agencies
>   (`lib/admin/accounts.ts`), users, resets, suspensions, and the per-agency
>   `allowUserManagement` switch. First admin: `npm run admin:create -- --email … --name …`.
> - **Agency Settings** `/settings` (admins): producer box, mailbox
>   (`lib/mail/settings.ts`), NowCerts (`lib/nowcerts/*`), auto-send, users.
> - **Secrets** (mail + NowCerts passwords) are sealed with the tenant DEK
>   (`lib/crypto/tenantSecrets.ts`) and have NO read path to a browser.
> - **Mail hosts are SSRF-guarded** (`lib/mail/netguard.ts`): public DNS names
>   only, TLS ports only, re-checked before every connection.
> - **Watcher** (`lib/gmail/watcher.ts`) supervises one IMAP loop per agency and
>   restarts a loop when its settings change. Only `MAIL_ENV_TENANT_SLUG` may fall
>   back to the `.env` mailbox — never another agency.
> - **NowCerts** is COPIED into clients/policies/vehicles (`source=nowcerts`),
>   so matching and assembly are untouched. Hand-entered rows are never touched.
>   Field names come from the Postman collection + https://api.nowcerts.com/Help
>   and are **not yet verified against a live account**.
> - **Auto-send** (`lib/certificate/autoSend.ts`) is per agency, OFF by default,
>   and only fires for `matched` / `requesterConfirmed` — through the normal
>   approve + deliver path, audited as the system.
> - **`DB_ENFORCE_RLS=1`**: `withTenant` does `SET LOCAL ROLE certflow_app`.
>   Before this, the app connected as a BYPASSRLS user and RLS was not enforced.
>
> Tests: `npm run verify:saas` (pure) and `DB_ENFORCE_RLS=1 npm run verify:saas:db`
> (throwaway database only — it creates and deletes agencies).
>
> **Connect your inbox, and the public site (2026-09-22).**
>
> - **OAuth inboxes.** Settings -> Email offers "Connect Gmail" and "Connect
>   Outlook"; `lib/mail/oauth.ts` (consent URL, signed single-use state, PKCE,
>   token refresh incl. Microsoft's ROTATING refresh tokens, revoke) and
>   `lib/mail/api.ts` (Gmail API / Graph, raw MIME both ways, so
>   `parseRawEmail` and the composer keep ingestion and threading identical to
>   IMAP). Routes: `app/api/mail/oauth/[provider]/{start,callback}`. The
>   callback is authenticated by the STATE cookie, not the session — a
>   SameSite=Strict session cookie does not survive the provider's redirect —
>   and re-checks the user in the database. Scopes are read+send only.
> - **App passwords still work** as "Advanced" for other providers.
> - **The watcher** polls OAuth inboxes (`MAIL_API_POLL_SECONDS`, default 10s)
>   instead of holding IMAP IDLE, and backs off to 5 minutes once a grant is
>   revoked, which only reconnecting fixes.
> - **Routing changed: the dashboard is now `/inbox`.** `/` is the public
>   marketing page (`app/welcome-landing`, `components/landing/*`), `/welcome`
>   redirects to it, and a signed-in visitor to `/` is sent to `/inbox`.
> - **`/signup` is "Request access", NOT self sign-up.** It records an enquiry
>   (`access_requests`); a Nestnic admin approves it in the console, which is
>   what creates the agency. Public endpoint: honeypot, per-IP and per-email
>   rate limits, same-origin only, grants nothing.
> - **lib/certificate/load.ts filters by tenant explicitly.** It used to rely on
>   RLS alone; with `DB_ENFORCE_RLS` off that put one agency's PRODUCER block on
>   another agency's certificate. Found by `npm run verify:ui`, fixed, and the
>   reason the flag should be on.
>
> Tests: `npm run verify:mail-oauth` (pure; network faked).
>
> **LLM reading is wired for the INSURED reader (2026-09-23).** `lib/llm/*`
> (the user's own code) reads an email and says which company the certificate
> is for; `lib/matching/interpret.ts` calls it, resolves its names against the
> client list exactly as it does the pattern reader's, and records every
> reading in `llm_readings`. Switched on with `LLM_READING` (per reader),
> `LLM_SHADOW=1` to compare without acting. Off => unchanged behaviour, which
> is how every suite runs.
>
> - The model may only return names and USDOT/MC numbers that appear VERBATIM in
>   the email (`acceptInsuredOutput` guards); a federal number beats a name.
>   It still cannot express a limit, a policy number or a recipient.
> - Added for it: `requestText`/`bodyAboveSignature` (extract.ts),
>   `stripOurExamples` (clarify.ts), exported `COMPETING` (identifier.ts),
>   `llmReadings` (schema, migration 0009), `lib/llm/messages.ts` (shared
>   `ownWords`/`messagesOf`/`FOLLOW_UP_SEPARATOR`).
> - **Not wired yet:** classify, vin, clarify (their readers exist in lib/llm).
>   `lib/llm/certificateHolder.ts.pending` needs a newer `lib/matching/holder.ts`
>   than this branch has - merge that first, then rename it back.
> - Verified live: an email phrased "the vendor agreement with Meridian
>   Logistics LLC" - which the patterns read as no name at all - now matches,
>   while the seeded emails that must be refused are still refused with the LLM on.
>
> > Known pre-existing failures in `npm run verify:ui`: "shows draft state" and
> "edit mode opens" — the certificate page says "DRAFT"/"Edit fields", the test
> still expects "Draft"/"Edit form". Not caused by the SaaS work.

**Prototype (UI layer):** state is client-side in `localStorage`; "email" and
"AMS360" data is hard-coded in [lib/seed.js](lib/seed.js). Both are being
replaced by the database — do not build on them.

**Connection note:** Supabase direct connections are IPv6-only; this machine has
no IPv6. `DATABASE_URL` must use the **session pooler**
(`aws-0-<region>.pooler.supabase.com:5432`, user `postgres.<ref>`), not the
direct host and not the 6543 transaction pooler.

---

## Commands

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint

npm run db:generate   # after editing db/schema.ts
npm run db:migrate    # applies migrations + db/rls.sql
npm run db:seed       # loads the Smart Way Solutions data from the sample PDF

npm run proof         # verify + render + rasterise. The demo artefact.
npm run verify        # 17-field proof vs COI_TRUCK_SOLUTION.PDF
npm run render        # -> out/certificate.pdf (2 pages)
npm run verify:api    # certificate lifecycle against the real DB (RLS on)

# Clicks the dashboard in real Chrome: sign in -> generate -> edit -> approve.
# Needs the dev server running; set UI_BASE if not on :3111.
npx next dev -p 3111 &
npm run verify:ui

npm run watch                  # the mailbox watcher, as its own process
npm run verify:vin             # VINs only when the requester asks. PURE.
npm run verify:clarify         # ambiguity -> ask the requester; MC/DOT lookup
npm run verify:clarify:live    # SENDS REAL MAIL. the whole exchange, live

# The three tests that send real mail are OPT-IN. Each run leaves a permanent
# message in a real mailbox; running them repeatedly during development filled
# one to capacity. They refuse to run without being asked:
#   SEND_REAL_MAIL=1 npm run verify:autopoll
#   SEND_REAL_MAIL=1 npm run verify:clarify:live
#   SEND_REAL_MAIL=1 npm run verify:delivery:live
#
# NOTE: the mailbox is opened READ-ONLY, so nothing in this system can delete
# test mail afterwards. That is deliberate, and it means clean-up is manual.
npm run verify:classify        # mailbox filter: what reaches the dashboard. PURE.
npm run verify:holder          # certificate holder read from the signature. PURE.
npm run verify:matching        # entity resolution, incl. the cases it must refuse
npm run verify:extraction      # email -> candidate name. PURE: no DB, no network.
npm run verify:interpretation  # extraction + resolution over the seeded inbox

npm run gmail:poll                    # read the real mailbox (read-only, idempotent)
npm run gmail:poll -- --days 2 --limit 5
npm run purge:ingested                # remove ingested mail; keeps the seeded set

# Sends a real email, then watches it appear on the dashboard with zero clicks.
# Needs the dev server running.
npm run verify:autopoll

npm run verify:delivery       # guardrails only — sends nothing
npm run verify:delivery:live  # SENDS REAL MAIL (mailbox to itself), full chain

# Deriving coordinates: print where text sits on any PDF, in map points.
npx tsx scripts/probe-pdf.mts COI_TRUCK_SOLUTION.PDF 2
npx tsx scripts/probe-pdf.mts COI_TRUCK_SOLUTION.PDF 1 "Smart Way"

npm run gen:acord101  # regenerates public/acord101-blank.{pdf,png}
```

`scripts/gen_template.py` is **superseded and unrunnable** (points at the old
sample filename; Python/PyMuPDF are not installed on this machine). Template
generation is now TypeScript via the WASM `mupdf` package —
`scripts/gen-acord101-template.mts` is the working example. `acord25-blank.*`
is already generated and checked in; don't regenerate it casually, the whole
coordinate map is calibrated to it.

## Stack

Next.js 14.2 App Router · React 18 · Tailwind 3.4 · pdf-lib 1.17 · plain JS (no
TypeScript) · `@/*` path alias → project root (see `jsconfig.json`).

---

## Architecture — the one thing to understand

The ACORD 25 form is **never re-drawn by hand**. A single coordinate map drives
both the on-screen editor and the generated PDF, so they cannot drift apart:

```
lib/acordMap.js      (page 1)  <- SINGLE SOURCE OF TRUTH (x/y in PDF points)
lib/acord101Map.js   (page 2)
   |-- components/AcordOverlay.js   HTML inputs absolutely positioned over a PNG
   |                                `sheet="acord25" | "acord101"` picks the map
   \-- lib/acordPdf.js              pdf-lib stamps text onto the blank PDF
```

- Page is **612 x 792 pt, TOP-LEFT origin**. `acordPdf.js` flips to PDF's
  bottom-left origin via `y = H - (yTop + size * ASCENT)` where `ASCENT = 0.8`.
- `AcordOverlay` scales everything by `S = width / 612` and applies
  `TWEAK_Y = -1.2` so HTML baselines sit on the printed rules.
- **If you change a coordinate, both renderers update automatically. Never
  hardcode a position in a component.**
- Coordinates are **measured, not guessed**. `scripts/probe-pdf.mts` prints
  where a filled sample put a value; box rules were found by scanning
  `acord25-blank.png` for dark rows/columns. Key measurements: free coverage
  block 554→590pt (3 rows @12pt), DESCRIPTION OF OPERATIONS 590→661.7pt
  (5 lines @9), PRODUCER box 134→194, INSURED 194→254, HOLDER 674→758.
- `h` on a `multi` field is **enforced** — the PDF renderer clamps output to
  `floor(h / lh)` lines. A wrong `h` silently truncates.
- **Typography is measured too, and it is one size.** Every filled-in value on
  `COI_TRUCK_SOLUTION.PDF` is `MyriadPro-Regular` at **7pt, regular weight,
  black** — page 1 and the ACORD 101 alike. Every bold face on that document
  belongs to the form's own preprinted captions (`Arial-BoldMT`, 5–8pt), never
  to the data. `DATA = 7` in `lib/acordMap.js` is exported and is the only
  place that number is written down; `acord101Map.js`, the insurer rows in both
  renderers, and `DESC_SIZE` / `REMARKS_SIZE` in `assemble.ts` all follow it.
  **Do not make a field bold or larger to emphasise it.** Data set above the
  weight of the captions around it is what makes a filled form look pasted
  together instead of typed on — that was a real defect, fixed by measurement.
  The lone exception is `authorizedRep`, which is italic 10pt because a
  signature should read as one; it sits at y=738, clear of the AUTHORIZED
  REPRESENTATIVE caption at 726–731.

### Data flow

```
Gmail --> lib/gmail/classify.ts   is this a COI request at all?
      --> lib/gmail/ingest.ts     store it, interpret it, DRAFT IT
                                  |-- lib/matching/holder.ts   who is asking
                                  -- lib/matching/interpret.ts who it is for

Postgres  coi_requests / clients / policies / vehicles / certificate_holders
      |
      |  lib/certificate/load.ts        rows -> AssembleInput
      |  lib/certificate/assemble.ts    pure: AssembleInput -> Certificate
      |  lib/certificate/service.ts     draft -> issued, audited, transactional
      v
app/api/*  requests | requests/:id/certificate | certificates/:id{,/pdf,/approve}
      |
      v
lib/store.js  StoreProvider / useStore()      fetch cache, NO localStorage
      |
      |-- app/page.js -> components/InboxView.js    request list, poll, MatchModal
      |-- app/certificates/page.js                  everything issued, + deliveries
      \-- app/certificate/[id]/page.js              AcordOverlay x2 (25 + 101), send
```

**Raw-SQL routes must format timestamps explicitly.** `/api/requests` and
`/api/certificates` use `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` because the
driver renders `timestamptz` as `2026-07-16 14:12:00+00`, which the UI's
hand-written date formatters (they split on `"T"` to keep `Date` out of render)
turn into `12:undefined AM`.

Every route goes through `route()` in [lib/api.ts](lib/api.ts), which checks the
origin on writes and resolves the session before touching a query. **The tenant
is never read from the client** — it comes from `requireSession()` and is handed
to `withTenant()`, which pins RLS for the transaction.

### Auth

```
lib/auth/cookie.ts    signed stateless cookie (Web Crypto — Edge-safe)
lib/auth/oidc.ts      Google/Entra sign-in, code flow + PKCE. No passwords:
                      db/schema.ts has no password column by design.
lib/auth/session.ts   getSession / requireSession / requireWrite
middleware.ts         redirects unauthenticated PAGES to /signin
```

- The cookie is a claim of identity; **authority is re-read from the database on
  every request**, so suspending a user or changing a role takes effect at once.
- `middleware.ts` is UX, **not** the security boundary — it runs on the Edge and
  cannot reach the database. Each API route calls `requireSession()` itself.
- Users are **never auto-provisioned** at OIDC callback; a row must already
  exist, or anyone with a Google account could land in a tenant.
- Rotating `SESSION_SECRET` signs everyone out — the "revoke all sessions" lever.

`request` shape: `{ id, status, priority, email{}, ams{}, certificate|null,
distribution? }` — status is `"new" | "ready" | "distributed"`.

`certificate` shape: `{ date, certificateNumber, revisionNumber, acordEdition,
producer{}, insured{}, insurers[{letter,name,naic}],
coverages{cgl,auto,umbrella,workersComp, other[]},
descriptionOfOperations, additionalRemarks[], acord101|null, holder{},
authorizedRep, signatureMode }`. Canonical definition:
[lib/certificate/types.ts](lib/certificate/types.ts).

- `coverages.other` is an **array** of up to 3 free rows (Motor Truck Cargo,
  Physical Damage…), not a single object.
- `descriptionOfOperations` and `acord101.remarks` are stored **already
  hard-wrapped** to their box widths, so the overlay and the PDF break lines in
  identical places. Don't re-wrap them downstream.
- `acord101` is non-null only when page 1 overflows; that is also the flag both
  renderers use to decide whether a second page exists.

Storage key: `certflow.state.v2` — **bump this when the certificate shape
changes**, or hydration will load stale objects.

---

## File map

| File | Lines | Purpose |
|---|---|---|
| [lib/acordMap.js](lib/acordMap.js) | ~145 | ACORD 25 `TEXT[]` + `CHECKS[]` map, `OTHER_ROWS`, `isChecked()` |
| [lib/acord101Map.js](lib/acord101Map.js) | 44 | ACORD 101 map (page 2) |
| [lib/acordPdf.js](lib/acordPdf.js) | ~135 | `buildCertificatePdf(cert, tpl25?, tpl101?)`, `downloadCertificatePdf` |
| [lib/certificate/text.ts](lib/certificate/text.ts) | 84 | `measureText` / `wrapLine` / `wrapBlock` — the only line-breaker |
| [lib/certificate/fontMetrics.ts](lib/certificate/fontMetrics.ts) | — | baked Helvetica widths (generated; do not hand-edit) |
| [lib/seed.js](lib/seed.js) | 464 | Fake data + `buildCertificate(request)` |
| [lib/store.js](lib/store.js) | 119 | Context store; `generateCertificate`, `updateCertificate`, `distribute`, `simulateIncoming`, `resetDemo` |
| [lib/path.js](lib/path.js) | 13 | `getPath` / `setPath` — immutable nested access by array path |
| [components/AcordOverlay.js](components/AcordOverlay.js) | 174 | The editable form (map-driven) |
| [components/InboxView.js](components/InboxView.js) | ~250 | Request list, poll, match dialog |
| [lib/gmail/classify.ts](lib/gmail/classify.ts) | ~180 | Is this a COI request? Runs before the insert |
| [lib/matching/holder.ts](lib/matching/holder.ts) | ~200 | Certificate holder, read from the signature |
| [components/DistributeModal.js](components/DistributeModal.js) | 171 | Auto-disburse / review & send (parked) |
| [components/AppShell.js](components/AppShell.js) | 154 | Collapsible sidebar + top bar |
| [components/icons.js](components/icons.js) | 118 | Inline SVG `Icon.*` set |
| [scripts/gen_template.py](scripts/gen_template.py) | 65 | Whites-out sample data -> blank PDF + PNG |

**Not imported anywhere** (each carries a header saying so):
- [components/AcordForm.js](components/AcordForm.js) — superseded by
  `AcordOverlay`. Dead; safe to delete.
- [lib/seed.js](lib/seed.js) — the prototype's fake email/AMS data. Superseded
  by `db/seed.ts`. Safe to delete.
- [components/DistributeModal.js](components/DistributeModal.js) — **parked, not
  dead.** Reinstate it for the delivery phase.

---

## Conventions

- Every interactive component starts with `"use client"` — there are no server
  components beyond `app/layout.js`.
- Imports use the `@/` alias (`@/lib/store`, `@/components/icons`).
- State updates are **immutable**; nested writes go through `setPath()`.
- Dates and money are **strings**, pre-formatted (`"08/07/2025"`,
  `"1,000,000"`). Nothing is parsed or localized — this deliberately avoids
  server/client hydration mismatches. `InboxView.formatTime` splits the ISO
  string manually for the same reason. **Do not introduce `new Date()` in
  render.**
- Empty values are `""`, never `null`. Renderers skip empty strings.
- Tailwind tokens: `brand-*` (Vertafore orange `#f26522`), `ink-*` (slate/navy
  text), `accent-*` (action blue). Cards use `rounded-2xl bg-white shadow-card`.
  Animations: `animate-fade-up`, `animate-scale-in`.
- `no-print` class marks chrome that must not appear in printed output.

## Gotchas

- **Checkbox gating** — `CHECKS` entries carry a `gate` path (e.g.
  `coverages.cgl.enabled`). An X only renders when the gate is truthy, so
  default radio values don't show on inactive coverage rows. Clicking a gated
  box in edit mode auto-enables its coverage.
- **Radio vs toggle** — `equals: "occur"` = radio-style (click sets the value);
  `toggle: true` = boolean flip. Both go through `isChecked()`.
- Insurer rows A–F are **not** in `TEXT[]`; they're generated from
  `INSURER_ROWS` (`y = 184 + i*12`), duplicated in both renderers — edit both.
- `acordPdf.js` fetches `/acord25-blank.pdf` at runtime, so PDF generation only
  works in the browser.
- The blank template assets are **generated**. To change what's stripped from
  the source PDF, edit `DATA_RECTS` in `gen_template.py` and re-run it.
- **BOTH blank templates have been REPAIRED and must not be regenerated
  casually.** They were made by painting white rectangles over a filled form to
  strip its data, and wherever one crossed a printed rule it erased the rule
  too; one clipped the bottom half off the AUTHORIZED REPRESENTATIVE caption,
  and one left a stray stub standing in the CERTIFICATE HOLDER box. Certificates
  then looked like text floating in open space — which reads as a rendering bug
  but is a defect in the ASSET: neither renderer draws a background, so no
  change to how text is stamped, **and no amount of routing the form through
  HTML and back**, could put back a line that is not in the file.
  `npm run repair:templates` fixes both and regenerates their PNGs — 11 rules,
  1 caption and 2 erased fragments on the ACORD 25; 3 rules on the ACORD 101.
  Not every fragment is a rule to complete: a leftover that serves nothing —
  the $-column divider intruding on the free coverage block, where a probe
  finds none of the `$` signs it exists to separate — is painted OUT, and
  `COI_TRUCK_SOLUTION.PDF` is the reference that settles which it is. The
  damaged originals are kept as `*.damaged.pdf` and each run rebuilds from
  them, so it is idempotent rather than cumulative.
- **Repairs are measured, never estimated**, and that includes weight.
  `npm run repair:templates -- --check` reports each rule's real extent, and
  `scripts/scan-rules.mts` scans any page at 4 px/pt for runs of dark pixels —
  a rule that stops mid-cell is damage. Weight matters as much as extent: the
  form's inner rules are **0.3125pt**, and a first pass drawn at 0.6 was
  visibly heavier than the rules it continued, which reads as the form being
  smudged exactly where the data sits. pdf-lib also centres a stroke on its
  path while the scan reports a rule's top edge, so every repair is offset by
  half a thickness. **If you ever regenerate a template from source, re-run the
  repair afterwards.**
- Hydration is guarded by `store.hydrated`; render a loading state before it's
  true or localStorage state will flash.

## Certificate lifecycle rules

These are enforced in [lib/certificate/service.ts](lib/certificate/service.ts)
and are not stylistic:

- **Drafting is automatic; issuing is not.** `generateDraft` runs unattended
  from `ingestGmail` as soon as a request resolves to an insured, so a reviewer
  opens a finished document to check rather than an empty one to trigger. There
  is no "generate" button. This does not weaken anything: a draft is still only
  a draft, and it carries the producer's contact as `authorizedRep` rather than
  a person who has not seen it. `approvedBy` is the field that means someone
  stood behind the document.
- **A drafting failure never fails the poll.** The request is on the dashboard
  either way; losing a whole run of incoming mail because one client's policy
  data is incomplete would be the worse trade.
- **An issued certificate is never mutated.** Editing is rejected once status
  leaves `draft`; a correction is a new revision of the *same* certificate
  number. A holder who got `COI-2026-0001` must see that number again, not a
  new one that leaves the first apparently still in force.
- **Reprints re-render the stored snapshot, never live policy data.** Policies
  renew; a reprint has to show what was certified on the day.
- **PDF bytes are deterministic** — `buildCertificatePdf` pins the document
  metadata, so the same snapshot always hashes the same. Without that,
  `certificates.pdfSha256` would be meaningless after any reprint.
- **Nothing is emailed automatically.** Approval issues the document; delivery
  is a separate, explicit, human action — `POST /api/certificates/:id/send` is
  the only outbound path, and only a button reaches it.
- **Send happens before the database records it.** If SMTP fails nothing is
  written and the reviewer retries. The other order would let us record a
  delivery that never happened, which is worse: the agency would believe the
  holder has the document.
- **The reviewer confirms the recipient.** The address is pre-filled from the
  request and editable, because a compliance inbox is often not the person who
  wrote in.
- **The client never supplies certificate values.** `PATCH` overwrites the
  submitted `certificateNumber` / `acordEdition` with the stored ones.
- `audit()` must be called in the **same transaction** as the change it records.

## Certificate holder rules

[lib/matching/holder.ts](lib/matching/holder.ts) reads the holder off the
bottom of the request email. It is the ONLY certificate field sourced from the
email rather than the database, and the reason is that the holder is whoever
asked — a broker onboarding a carrier, a bank financing a tractor — and the
agency has no record of them until they write in.

- **It reads only BELOW the sign-off.** `extract.ts` reads only above it. That
  split is the safety property: a name in a signature can become the holder,
  which is an addressee, but never the insured, whose coverage the document
  actually asserts. The worst a bad read here can do is address the certificate
  imperfectly, in a field the reviewer is looking straight at.
- **The LAST sign-off wins**, not the first — "thanks for the quick turnaround"
  appears mid-body constantly, and the block we want is at the bottom.
- **Phone numbers, bare emails and URLs are dropped.** The ACORD holder box is a
  postal address block with four lines; contact details would spend them.
- **Never empty.** With no usable signature it falls back to the sender's
  display name and address — still the requester, and still better than a
  stranger pulled from a table.
- Lines are stored **already hard-wrapped** to the 246pt box, like every other
  block on this form. Do not re-wrap downstream.
- Blocks are deduplicated into `certificate_holders` on name + address, so the
  same broker reuses a row. Matching on the full block keeps two people at one
  brokerage distinct — the certificate names one of them.

## Entity resolution rules

[lib/matching/resolve.ts](lib/matching/resolve.ts) turns a name into a client
record. Thresholds are `STRONG` (auto-match floor) and `MARGIN` (required lead
over the runner-up); raising either makes the system ask a human more often,
which is the safe direction.

- **It abstains on purpose.** A near-tie is `ambiguous`, not a 51% win —
  "Smith Trucking LLC" and "Smith Trucking of Ohio LLC" are different companies
  with different policies.
- **Never add a containment/subset bonus to the score.** Tried once: because
  "Smart Way Solutions" is contained in "Smart Way Solutions of Ohio", the bonus
  scored a *different* company at 1.00. The extra words in a longer name are
  exactly what distinguish two related entities. Suffix handling belongs in
  `normalizeName()`, where it is explicit.
- Ranking is one indexed query — the GIN trigram indexes are in `db/rls.sql`.

## Interpretation rules

[lib/matching/extract.ts](lib/matching/extract.ts) reads the email;
[lib/matching/interpret.ts](lib/matching/interpret.ts) joins it to
[resolve.ts](lib/matching/resolve.ts) and records the outcome.

- **The sender is not the insured.** A broker requesting a COI for its carrier
  is the *holder*; its name is in the from-address and the signature and is the
  wrong answer. `extract.ts` truncates the body at the signature block and only
  reads names from positions that state who the certificate is *for*.
- **Extracting nothing is a valid outcome** — it means the email never said.
  That routes to `needsMatch`, which is correct, not a failure.
- **Interpretation can only choose a `clientId`.** It has nowhere to put a
  limit, a policy number or a date, so a wrong answer shows a human the wrong
  company; it can never put false coverage on a document.

## Automatic checking rules

The dashboard polls; there is no server-side daemon. `components/InboxView.js`
drives it, `ingestGmailShared` (foot of [lib/gmail/ingest.ts](lib/gmail/ingest.ts))
protects the mailbox from it.

- **Nothing polls when nobody is looking.** The timer lives in the browser, so
  the mailbox is only read on behalf of someone watching the result. A request
  that arrives overnight is ingested the moment the dashboard opens, and
  `received_at` comes from the email, so nothing about its record is lost.
- **A background tab does not poll.** `visibilitychange` pauses it and fires one
  check on return — the moment current state actually matters.
- **N tabs are not N mailbox reads.** `ingestGmailShared` coalesces concurrent
  callers onto one read and enforces a 15s floor per tenant, replaying the
  previous outcome — including a failure — inside that window. It is
  process-local and deliberately not a distributed lock: the unique index on
  (tenant, gmail_message_id) is what makes double ingestion harmless.
- **An automatic check that found nothing says nothing.** Only a manual check,
  or an automatic one that actually ingested something, draws the banner. A
  dashboard that redraws every 25 seconds teaches the reviewer to stop reading
  it, and then it is worth nothing on the day it matters.
- **Giving up is visible.** Three consecutive failures — or one permission
  error, which will never fix itself — stops the timer and says so, with a
  retry. Silently ceasing to check is the worst of the available outcomes:
  the screen looks calm while requests pile up unseen.

## Clarification rules

When the resolver refuses because two clients are too alike, the system asks the
REQUESTER rather than a reviewer. [lib/matching/clarify.ts](lib/matching/clarify.ts)
composes the question, [clarifyService.ts](lib/matching/clarifyService.ts) sends
it and reads the answer.

- **The requester knows; a reviewer does not.** The agency's records cannot say
  which of its own clients a stranger meant. The person onboarding that carrier
  has its paperwork in front of them.
- **This is the ONLY mail the system sends without a human.** It carries no
  coverage, no limits, no policy numbers and no document — nothing anyone could
  rely on. `GMAIL_CLARIFY=0` disables it and those requests go to a reviewer as
  before.
- **It asks once.** `clarification_sent_at` is set and never cleared. Two
  unanswered questions in one thread read as a malfunction.
- **It names only the candidates the requester's own words implied**, never the
  wider client list, and never their addresses or client numbers.
- **A USDOT or MC number beats a name in the same reply.** Names are not unique;
  federal identifiers are. There is NO fuzzy matching on an identifier — digits
  transposed in a DOT number name a completely unrelated carrier, so it matches
  exactly or not at all.
- **The quoted question is stripped before reading the answer.** Our own message
  lists every candidate and contains example numbers; reading it back would make
  every reply look ambiguous.
- **An unusable reply does not trigger a second question.** It goes to
  `needsMatch`, in front of a person who can read what was actually written.
- **Outbound automated mail is stamped** (`X-CertFlow-Auto`) and skipped on
  ingest. We read the mailbox we send from, so without this the system answers
  itself.

## VIN disclosure rules

[lib/matching/vinRequest.ts](lib/matching/vinRequest.ts) decides whether the
fleet list carries vehicle identification numbers.

- **Off unless asked.** A schedule with VINs is an inventory of the insured's
  rolling stock. Most requests need limits and dates, not serial numbers, and
  printing them anyway discloses more of the insured's business than was asked
  for — to a third party the insured did not choose.
- **The inversions must not fire.** "No VINs needed" contains the word being
  looked for; declines are checked before requests.
- **Withholding them shortens the lines**, so a fleet that needed an ACORD 101
  may now fit on one page. That follows automatically from wrapped-line
  measurement; nothing downstream needs to know which mode produced it.
- The reviewer can still add them by hand. This decides what the DRAFT contains,
  not what is permitted.

## Live update rules

- **The browser never polls the mailbox.** A server-side watcher does, and
  pushes over SSE. Nothing reloads and there is no button.
- **One connection, two mechanisms.** The server's own IDLE announcement is the
  fast path; a UID check on that same open connection every couple of seconds is
  the ceiling. Reconnecting per check would be ~17,000 IMAP logins a day.
- **NOOP before SEARCH.** An open mailbox is a snapshot; without NOOP the server
  keeps returning the view the connection had when it opened. This cost an
  afternoon.
- **The request is announced before its certificate is drafted.** Drafting is
  several more round trips, and making the reviewer wait for it before the
  request even appears is the difference between live and slow.
- **Events cross processes via Postgres LISTEN/NOTIFY**, because the watcher and
  the web server are different processes. Requires a SESSION-mode connection —
  the transaction pooler will not deliver them.
- **A lost event is survivable.** It carries no data, only "go and look", and the
  dashboard still refreshes on its own timer and on tab focus.

## Mailbox rules

[lib/gmail/classify.ts](lib/gmail/classify.ts) decides what becomes a request.
It runs in `ingestGmail` **before** `storeEmail`, so mail that is not a COI
request never reaches the database.

- **Filter before insert, not after.** The 30-day `purgeAfter` promise is about
  COI requests; it is not a licence to store the rest of an agency's mail for a
  month. Nothing we never wrote down can leak.
- **A skip is never silent.** `IngestResult.ignored` carries every passed-over
  subject with its reason; the poll banner and `npm run gmail:poll` both print
  them. A false negative loses a customer's request, so it has to be visible.
- **Unreplyable senders are refused on principle, not as spam filtering.** We
  answer by replying in-thread; an address that discards replies cannot be the
  origin of a request we can fulfil, whatever its subject line says.
- **Insurance vocabulary alone is not a request.** A renewal notice says
  "policy" and "coverage" throughout without asking for anything. The threshold
  needs the document named — certificate of insurance, COI, or ACORD.

## Delivery allowlist

`DELIVERY_ALLOWLIST` is the only lever on who can be emailed:

| Value | Effect |
|---|---|
| unset, outside production | only `GMAIL_USER` — the safe default |
| unset, production | anyone |
| `*` | anyone (**what a live agency runs**) |
| `a@b.com,@partner.com` | exactly those |

The reserved-domain check (`.example`/`.invalid`/`.test`) is **not** part of
the allowlist and `*` does not lift it — that is what stops a click on seeded
demo data from emailing a real company.

## Scope boundary

Everything from arrival onward is real: ingestion, filtering, interpretation,
matching, assembly, approval, delivery. What remains simulated is nothing in
the request path — the gaps are operational (rate limiting, scheduled purge,
audit viewer) and the Gmail transport is still an App Password rather than
per-tenant OAuth.
