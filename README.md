# CertFlow — Certificate of Insurance Automation (MVP)

CertFlow is a tool-as-a-service prototype that automates the creation of **ACORD 25
Certificates of Liability Insurance (COI)**. It watches for inbound COI request
emails, pulls the insured's company and policy data from the agency management
system (AMS), auto-fills a **pixel-perfect ACORD 25 form**, lets the user review
and edit it, and then either **auto-disburses** it or hands it back for
**review & send**.

> **Prototype scope:** The email trigger and AMS360 data fetch are *simulated*
> (button + seeded data). The certificate editing and distribution flows are
> fully functional. The generated PDF is filled onto the **real ACORD 25
> template**, so the output is 100% identical to a genuine certificate.

---

## The flow

1. **Request Inbox** — Inbound COI requests arrive (simulated). The
   *"Simulate incoming request"* button injects a new one, standing in for the
   real email trigger.
2. **Auto-generate** — Generating a certificate runs an animated pipeline:
   *read email → extract holder & requested coverages → match the insured in
   AMS360 → pull policies & limits → fill ACORD 25.*
3. **ACORD 25 certificate** — A faithful, editable ACORD 25 (2025/12) form,
   pre-filled. A provenance panel shows which fields came from the **email**
   vs **AMS360**.
4. **Manual edit** — *Edit form* makes every field and checkbox editable; changes
   save automatically.
5. **Two ways to send:**
   - **Auto-Disburse** — issues and sends to the requester immediately.
   - **Review & Send** — pick a distribution method (Download PDF / InsurLink
     Email / Do Not Distribute) and send yourself.

---

## How the "100% identical template" works

The real form structure is never re-drawn by hand:

- `COI TRUCK SOLUTION .PDF` (the supplied sample) is stripped of its data to
  produce a **blank ACORD 25 template** — `public/acord25-blank.pdf` (for output)
  and `public/acord25-blank.png` (for the on-screen background).
- `lib/acordMap.js` holds the exact field coordinates (in PDF points) for every
  input and checkbox.
- On screen, `components/AcordOverlay.js` renders editable fields positioned
  precisely over the template image.
- On download/send, `lib/acordPdf.js` (pdf-lib) stamps the data onto the blank
  template PDF using the same coordinate map.

Regenerate the blank template assets with
`scripts/gen_template.py` (requires Python + PyMuPDF) if the base PDF changes.

---

## Tech stack

- **Next.js 14** (App Router) + **React 18**
- **Tailwind CSS**
- **pdf-lib** for client-side PDF generation
- No backend — state persists in `localStorage` (seeded from `lib/seed.js`)

## Getting started

```bash
npm install
npm run dev
# open http://localhost:3000
```

## Project structure

```
app/                       App Router pages
  page.js                  Request Inbox
  certificate/[id]/page.js Certificate editor
components/
  AppShell.js              Sidebar + top bar (collapsible)
  AcordOverlay.js          ACORD 25 template + positioned editable fields
  DistributeModal.js       Auto-disburse / review & send
  ...
lib/
  seed.js                  Simulated email + AMS360 data
  acordMap.js              ACORD 25 field coordinate map
  acordPdf.js              Fills the real template via pdf-lib
  store.js                 Client store (localStorage)
public/
  acord25-blank.pdf/.png   Blank ACORD 25 template (generated)
```

---

*Prototype built for Nestnic Solutions. ACORD® and the ACORD 25 form are
registered marks of ACORD Corporation; the blank form is used here only to
demonstrate certificate automation.*
