/**
 * The whole chain, against the real mailbox.
 *
 *   npm run verify:delivery:live
 *
 * SENDS REAL EMAIL — twice, and both to the configured mailbox itself:
 *   1. a COI request, so there is something genuine to ingest
 *   2. the certificate, as a reply in that same thread
 *
 * Because the account writes to itself, nobody else can receive anything, and
 * the allowlist in lib/gmail/send.ts enforces that independently.
 *
 * Proves: email arrives -> insured identified -> certificate assembled ->
 * approved -> replied to in-thread with the PDF attached.
 */

import "@/lib/env";
import { desc, eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { db, withTenant } from "@/lib/db/client";
import { coiRequests, deliveries, tenants, users } from "@/db/schema";
import { gmailConfigFromEnv } from "@/lib/gmail/inbox";
import { ingestGmail } from "@/lib/gmail/ingest";
import { approve, generateForRequest } from "@/lib/certificate/service";
import { renderCertificatePdf, sha256 } from "@/lib/certificate/render";
import { deliverCertificate } from "@/lib/certificate/deliver";
import type { Session } from "@/lib/auth/session";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const SUBJECT = `COI request — Smart Way Solutions Inc [${Date.now()}]`;

async function sendTestRequest(): Promise<string> {
  const config = gmailConfigFromEnv();
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: config.user, pass: config.appPassword },
  });
  try {
    const info = await transport.sendMail({
      from: config.user,
      to: config.user,
      subject: SUBJECT,
      text: [
        "Hi,",
        "",
        "Please send a current certificate of insurance for Smart Way Solutions Inc.",
        "We need it on file before the next load.",
        "",
        "Thanks,",
        "Compliance",
      ].join("\n"),
    });
    return info.messageId;
  } finally {
    transport.close();
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * SENDS REAL MAIL — opt in with SEND_REAL_MAIL=1.
 *
 * Guarded because these tests are cheap to run and expensive to have run: each
 * one leaves a permanent message in a real mailbox, and repeated runs during
 * development filled one to capacity. A test that quietly consumes somebody's
 * storage should have to be asked for.
 */
function requireOptIn(name: string): void {
  if (process.env.SEND_REAL_MAIL === "1") return;
  console.log(`\n${name} sends real email and is opt-in.`);
  console.log("Set SEND_REAL_MAIL=1 to run it:\n");
  console.log(`  SEND_REAL_MAIL=1 npm run ${name}\n`);
  process.exit(0);
}

async function main() {
  requireOptIn("verify:delivery:live");

  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, "whittington"));
  if (!tenant) throw new Error("Tenant not seeded. Run: npm run db:seed");
  const [user] = await db.select().from(users).where(eq(users.tenantId, tenant.id)).limit(1);

  const session: Session = {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };

  console.log(`mailbox: ${process.env.GMAIL_USER}\n`);

  // ---- 1. a real inbound request ----
  const sentId = await sendTestRequest();
  check("sent a COI request to the mailbox", Boolean(sentId));

  // ---- 2. ingest it ----
  let request: typeof coiRequests.$inferSelect | undefined;
  for (let attempt = 1; attempt <= 6 && !request; attempt++) {
    await wait(attempt === 1 ? 6000 : 5000);
    await ingestGmail(tenant.id, { since: new Date(Date.now() - 10 * 60 * 1000), limit: 15 });
    [request] = await withTenant(tenant.id, (tx) =>
      tx.select().from(coiRequests).where(eq(coiRequests.subject, SUBJECT)).limit(1)
    );
    if (!request) console.log(`   …not delivered yet (attempt ${attempt})`);
  }
  check("ingested from Gmail", Boolean(request), request ? `id ${request.id.slice(0, 8)}` : "gave up");
  if (!request) process.exit(1);

  check("stored the Message-ID for threading", Boolean(request.gmailMessageId), request.gmailMessageId);
  check("read the body", Boolean(request.bodyText?.includes("Smart Way Solutions")));
  check("set a retention deadline", request.purgeAfter !== null);

  // ---- 3. interpretation ----
  check("identified the insured", request.status === "ready" && Boolean(request.clientId), request.status);

  // ---- 4. assemble + approve ----
  const draft = await generateForRequest(session, request.id);
  check("assembled a certificate", draft.status === "draft", draft.certificateNumber);
  check("insured came from the database", draft.snapshot.insured.name === "Smart Way Solutions Inc");

  const bytes = await renderCertificatePdf(draft.snapshot);
  const issued = await approve(session, draft.id, sha256(bytes));
  check("issued", issued.status === "issued");

  // ---- 5. deliver, in thread ----
  const delivery = await deliverCertificate(session, draft.id, process.env.GMAIL_USER);
  check("sent the certificate", Boolean(delivery.providerMessageId), delivery.providerMessageId);
  check("threaded as a reply", delivery.threaded);
  check("addressed to the requester", delivery.to === process.env.GMAIL_USER, delivery.to);

  // ---- 6. recorded ----
  const rows = await withTenant(tenant.id, (tx) =>
    tx.select().from(deliveries).where(eq(deliveries.certificateId, draft.id))
  );
  check("delivery recorded", rows.length === 1, `${rows.length} row(s)`);
  check("records who sent it", rows[0]?.sentBy === session.userId);

  const [after] = await withTenant(tenant.id, (tx) =>
    tx.select().from(coiRequests).where(eq(coiRequests.id, request!.id))
  );
  check("request marked sent", after.status === "sent", after.status);

  console.log(
    failures === 0
      ? `\nall live delivery checks passed — look in ${process.env.GMAIL_USER} for the reply, with the PDF attached, under the original message.`
      : `\n${failures} FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
