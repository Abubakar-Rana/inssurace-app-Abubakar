/**
 * Can we reach the mailbox, and are we allowed to?
 *
 * SENDS NOTHING. It opens the read connection, opens the folder read-only, and
 * asks the send server to authenticate without handing it a message. That is
 * enough to prove credentials, and it costs the mailbox nothing.
 *
 * Worth having as its own command because a wrong or expired App Password
 * produces the same outward symptom as a quiet mailbox: no requests appear.
 * This separates "nobody has written in" from "we cannot get in".
 *
 *   npm run verify:mailbox
 */

import "@/lib/env";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { gmailConfigFromEnv } from "@/lib/gmail/inbox";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

async function main() {
  let config;
  try {
    config = gmailConfigFromEnv();
  } catch (err) {
    check("configuration present", false, (err as Error).message);
    process.exit(1);
  }

  console.log(`\nmailbox: ${config.user}\n`);
  check("an app password is configured", config.appPassword.length > 0, `${config.appPassword.length} characters`);

  // ---- reading ----
  const client = new ImapFlow({
    host: config.host ?? "imap.gmail.com",
    port: config.port ?? 993,
    secure: true,
    auth: { user: config.user, pass: config.appPassword },
    logger: false,
  });

  let opened = false;
  try {
    await client.connect();
    check("signs in for reading (IMAP)", true);

    // readOnly: proves the folder opens the way the running system opens it.
    const lock = await client.getMailboxLock(config.mailbox ?? "INBOX", { readOnly: true });
    opened = true;
    try {
      const box = client.mailbox;
      const count = box && typeof box !== "boolean" ? box.exists : 0;
      check("opens the inbox read-only", true, `${count} message(s) in the folder`);
    } finally {
      lock.release();
    }
  } catch (err) {
    const message = (err as Error).message;
    check("signs in for reading (IMAP)", false, message);
    if (/AUTHENTICATIONFAILED|Invalid credentials/i.test(message)) {
      console.log("\n  The address and the app password do not belong together.");
      console.log("  Generate one for THIS account at https://myaccount.google.com/apppasswords");
      console.log("  (the account needs 2-Step Verification switched on first).\n");
    }
  } finally {
    if (opened) await client.logout().catch(() => client.close());
    else client.close();
  }

  // ---- sending ----
  const transport = nodemailer.createTransport({
    host: process.env.GMAIL_SMTP_HOST ?? "smtp.gmail.com",
    port: Number(process.env.GMAIL_SMTP_PORT ?? 465),
    secure: true,
    auth: { user: config.user, pass: config.appPassword },
  });

  try {
    // Authenticates and disconnects. No message is composed or sent.
    await transport.verify();
    check("signs in for sending (SMTP)", true, "no mail was sent");
  } catch (err) {
    check("signs in for sending (SMTP)", false, (err as Error).message);
  } finally {
    transport.close();
  }

  console.log(
    failures ? `\n${failures} FAILED — the system cannot use this mailbox yet.\n` : `\nMailbox reachable both ways.\n`
  );
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
