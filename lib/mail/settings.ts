/**
 * Which mailbox belongs to which agency.
 *
 * Each agency connects its own inbox in Settings (tenant_mail_settings). The
 * password is sealed with that agency's data key and opened only here, in the
 * process about to connect — never returned to a browser.
 *
 * BACKWARD COMPATIBILITY: before agencies could configure a mailbox, one
 * deployment mailbox came from GMAIL_USER / GMAIL_APP_PASSWORD. That still works
 * for exactly one agency — MAIL_ENV_TENANT_SLUG (default: DEV_TENANT_SLUG, then
 * "whittington") — until it saves its own settings. Every OTHER agency without
 * settings has no mailbox at all. Falling back to the environment mailbox for
 * everyone would ingest one agency's mail into another's account.
 */

import { eq } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { db, withTenant } from "@/lib/db/client";
import { tenantMailSettings, tenants } from "@/db/schema";
import { audit } from "@/lib/audit";
import { openSecret, sealSecret } from "@/lib/crypto/tenantSecrets";
import { ServiceError } from "@/lib/certificate/service";
import { gmailConfigFromEnv, type GmailConfig } from "@/lib/gmail/inbox";
import { assertPort, assertPublicHost, IMAP_PORTS, SMTP_PORTS, UnsafeHostError } from "./netguard";
import {
  forgetAccessToken,
  isOAuthProvider,
  providerConfigured,
  revokeGrant,
  type Connection,
  type OAuthProvider,
} from "./oauth";

export function legacyMailSlug(): string {
  return process.env.MAIL_ENV_TENANT_SLUG ?? process.env.DEV_TENANT_SLUG ?? "whittington";
}

function envMailboxConfigured(): boolean {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

export class MailNotConfigured extends Error {
  constructor() {
    super("No mailbox is connected for this agency. An admin can connect one in Settings → Email.");
    this.name = "MailNotConfigured";
  }
}

/** The mailbox for an agency, decrypted, or null when it has none (or it is switched off). */
export async function tryMailConfigFor(tenantId: string): Promise<GmailConfig | null> {
  const found = await withTenant(tenantId, async (tx) => {
    const [row] = await tx.select().from(tenantMailSettings).where(eq(tenantMailSettings.tenantId, tenantId));
    if (!row) return { row: null, password: null };
    if (!row.enabled) return { row, password: null };
    // OAuth inboxes hold no password; their token is opened per request in lib/mail/oauth.ts.
    if (isOAuthProvider(row.provider)) return { row, password: "" };
    if (!row.passwordEnc) return { row, password: null };
    return { row, password: await openSecret(tx, tenantId, row.passwordEnc) };
  });

  if (found.row) {
    if (found.password === null) return null; // configured but switched off (or incomplete)
    const r = found.row;
    if (isOAuthProvider(r.provider)) {
      return {
        user: r.emailAddress,
        appPassword: "",
        fromAddress: r.emailAddress,
        tenantConfigured: true,
        oauth: { tenantId, provider: r.provider },
      };
    }
    return {
      user: r.username ?? r.emailAddress,
      appPassword: found.password,
      host: r.imapHost ?? undefined,
      port: r.imapPort,
      mailbox: r.mailbox,
      smtpHost: r.smtpHost ?? undefined,
      smtpPort: r.smtpPort,
      fromAddress: r.emailAddress,
      tenantConfigured: true,
    };
  }

  if (!envMailboxConfigured()) return null;
  const [tenant] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
  return tenant?.slug === legacyMailSlug() ? gmailConfigFromEnv() : null;
}

export async function mailConfigFor(tenantId: string): Promise<GmailConfig> {
  const config = await tryMailConfigFor(tenantId);
  if (!config) throw new MailNotConfigured();
  return config;
}

/**
 * Every agency whose mailbox should be watched, with a version string that
 * changes whenever its settings do — the watcher reconnects on a change.
 */
export async function listWatchedMailboxes(): Promise<{ tenantId: string; version: string }[]> {
  // Cross-agency by necessity: this is the worker deciding what to watch. It
  // reads ids and timestamps only; credentials are opened per agency later.
  const rows = await db
    .select({
      tenantId: tenants.id,
      slug: tenants.slug,
      status: tenants.status,
      enabled: tenantMailSettings.enabled,
      updatedAt: tenantMailSettings.updatedAt,
    })
    .from(tenants)
    .leftJoin(tenantMailSettings, eq(tenantMailSettings.tenantId, tenants.id));

  const out: { tenantId: string; version: string }[] = [];
  for (const r of rows) {
    if (r.status !== "active") continue;
    if (r.updatedAt) {
      if (r.enabled) out.push({ tenantId: r.tenantId, version: r.updatedAt.toISOString() });
    } else if (r.slug === legacyMailSlug() && envMailboxConfigured()) {
      out.push({ tenantId: r.tenantId, version: "env" });
    }
  }
  return out;
}

/** Re-validate an agency's hosts right before connecting (DNS can change after saving). */
export async function guardConfig(config: GmailConfig): Promise<void> {
  // OAuth inboxes only ever talk to the providers' fixed API hosts.
  if (!config.tenantConfigured || config.oauth) return;
  await assertPublicHost(config.host ?? "");
  await assertPublicHost(config.smtpHost ?? "");
  assertPort(config.port ?? 0, IMAP_PORTS, "IMAP");
  assertPort(config.smtpPort ?? 0, SMTP_PORTS, "SMTP");
}

// ---------------------------------------------------------------- settings screen

export interface MailSettingsView {
  configured: boolean;
  /** "google" | "microsoft" (connected by pop-up) | "imap" (app password) | null. */
  provider: string | null;
  /** Which pop-up buttons this server can offer (Nestnic registered the app with that provider). */
  available: { google: boolean; microsoft: boolean };
  /** True when this agency is still on the deployment's .env mailbox. */
  usingEnvironmentMailbox: boolean;
  emailAddress: string;
  username: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  enabled: boolean;
  /** Never the password itself — only whether one is stored. */
  passwordSet: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export async function getMailSettingsView(tenantId: string, tenantSlug: string): Promise<MailSettingsView> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx.select().from(tenantMailSettings).where(eq(tenantMailSettings.tenantId, tenantId))
  );
  const usingEnv = !row && tenantSlug === legacyMailSlug() && envMailboxConfigured();
  return {
    configured: Boolean(row) || usingEnv,
    provider: row?.provider ?? (usingEnv ? "imap" : null),
    available: { google: providerConfigured("google"), microsoft: providerConfigured("microsoft") },
    usingEnvironmentMailbox: usingEnv,
    emailAddress: row?.emailAddress ?? (usingEnv ? process.env.GMAIL_USER ?? "" : ""),
    username: row?.username ?? "",
    imapHost: row?.imapHost || "imap.gmail.com",
    imapPort: row?.imapPort ?? 993,
    smtpHost: row?.smtpHost || "smtp.gmail.com",
    smtpPort: row?.smtpPort ?? 465,
    enabled: row?.enabled ?? true,
    passwordSet: Boolean(row?.passwordEnc),
    lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
    lastError: row?.lastError ?? null,
  };
}

export interface MailSettingsInput {
  emailAddress?: unknown;
  username?: unknown;
  /** Omit or leave blank to keep the stored password. */
  password?: unknown;
  imapHost?: unknown;
  imapPort?: unknown;
  smtpHost?: unknown;
  smtpPort?: unknown;
  enabled?: unknown;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Validate input into a connectable config. `storedPassword` fills a blank password field. */
export async function toConfig(input: MailSettingsInput, storedPassword?: string | null): Promise<GmailConfig> {
  const emailAddress = str(input.emailAddress).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailAddress)) throw new ServiceError("Enter the mailbox email address.");
  // Nearly every provider signs in with the full email address. People often
  // type a display name here ("nestnic supplies"), which the server then
  // rejects as a bad password — a confusing failure for something we can simply
  // get right. Anything that is not an address is treated as "same as email".
  const typedUsername = str(input.username);
  const username = typedUsername.includes("@") ? typedUsername : emailAddress;
  // Google shows app passwords in groups of four; the servers want them bare.
  const password = str(input.password).replace(/\s+/g, "") || storedPassword || "";
  if (!password) throw new ServiceError("Enter the app password.");
  if (password.length > 256) throw new ServiceError("That password is too long.");

  const config: GmailConfig = {
    user: username,
    appPassword: password,
    host: str(input.imapHost).toLowerCase(),
    port: Number(input.imapPort) || 993,
    mailbox: "INBOX",
    smtpHost: str(input.smtpHost).toLowerCase(),
    smtpPort: Number(input.smtpPort) || 465,
    fromAddress: emailAddress,
    tenantConfigured: true,
  };
  try {
    await guardConfig(config);
  } catch (err) {
    if (err instanceof UnsafeHostError) throw new ServiceError(err.message);
    throw err;
  }
  return config;
}

/**
 * Prove the settings work: log in to IMAP and open the inbox READ-ONLY, then
 * log in to SMTP without sending anything. Error messages are the provider's
 * own, trimmed — never the password, which no library message contains.
 */
export async function testMailConfig(config: GmailConfig): Promise<{ imap: string; smtp: string }> {
  await guardConfig(config);
  const client = new ImapFlow({
    host: config.host!,
    port: config.port!,
    secure: true,
    auth: { user: config.user, pass: config.appPassword },
    logger: false,
  });
  client.on("error", () => {});
  let imap: string;
  try {
    await client.connect();
    const lock = await client.getMailboxLock(config.mailbox ?? "INBOX", { readOnly: true });
    lock.release();
    imap = "Connected and opened the inbox (read-only).";
  } catch (err) {
    throw new ServiceError(`Could not read the inbox: ${friendly(err)}`, 422);
  } finally {
    await client.logout().catch(() => client.close());
  }

  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    requireTLS: true,
    auth: { user: config.user, pass: config.appPassword },
  });
  try {
    await transport.verify();
  } catch (err) {
    throw new ServiceError(`Inbox works, but sending does not: ${friendly(err)}`, 422);
  } finally {
    transport.close();
  }
  return { imap, smtp: "Signed in to the outgoing mail server (nothing was sent)." };
}

function friendly(err: unknown): string {
  const e = err as { authenticationFailed?: boolean; responseText?: string; message?: string; code?: string };
  if (e?.authenticationFailed || /auth/i.test(e?.message ?? "") || e?.code === "EAUTH") {
    // The provider will not say WHY, so list what it is in practice. Each of
    // these has cost someone an afternoon at least once.
    return (
      "the email address or app password was rejected. Check that: " +
      "(1) the app password was created while signed in to this same mailbox account; " +
      "(2) 2-Step Verification is on for that account — app passwords do not exist without it; " +
      "(3) the app password is still listed in the account (a deleted one stops working immediately); " +
      "and (4) it is an App Password, not the normal account password."
    );
  }
  return (e?.responseText || e?.message || "unknown error").slice(0, 200);
}

export async function saveMailSettings(
  session: { tenantId: string; userId: string; email: string },
  input: MailSettingsInput,
  opts: { test: boolean }
): Promise<{ imap?: string; smtp?: string }> {
  const stored = await withTenant(session.tenantId, async (tx) => {
    const [row] = await tx.select().from(tenantMailSettings).where(eq(tenantMailSettings.tenantId, session.tenantId));
    return row?.passwordEnc ? openSecret(tx, session.tenantId, row.passwordEnc) : null;
  });
  const config = await toConfig(input, stored);
  const checked = opts.test ? await testMailConfig(config) : {};
  const enabled = input.enabled === undefined ? true : input.enabled === true;

  await withTenant(session.tenantId, async (tx) => {
    const values = {
      // Saving an app password replaces any pop-up connection.
      provider: "imap",
      oauthRefreshTokenEnc: null,
      oauthScopes: null,
      connectedBy: session.userId,
      emailAddress: config.fromAddress!,
      username: config.user,
      passwordEnc: await sealSecret(tx, session.tenantId, config.appPassword),
      imapHost: config.host!,
      imapPort: config.port!,
      smtpHost: config.smtpHost!,
      smtpPort: config.smtpPort!,
      enabled,
      lastError: null,
      updatedAt: new Date(),
    };
    await tx
      .insert(tenantMailSettings)
      .values({ tenantId: session.tenantId, ...values })
      .onConflictDoUpdate({ target: tenantMailSettings.tenantId, set: values });
    await audit(tx, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "settings.mail_saved",
      subjectType: "tenant",
      subjectId: session.tenantId,
      // Never the password — not even a hash of it.
      after: {
        emailAddress: values.emailAddress,
        imapHost: values.imapHost,
        smtpHost: values.smtpHost,
        enabled,
        passwordChanged: Boolean(str(input.password)),
      },
    });
  });
  return checked;
}

export async function disconnectMail(session: { tenantId: string; userId: string }): Promise<void> {
  // Ask the provider to cancel the grant too, so the token is dead even if a
  // copy of it ever existed anywhere. Best effort: removing our copy is what matters.
  const grant = await openGrant(session.tenantId);
  if (grant) await revokeGrant(grant.provider, grant.token);
  forgetAccessToken(session.tenantId);

  await withTenant(session.tenantId, async (tx) => {
    await tx.delete(tenantMailSettings).where(eq(tenantMailSettings.tenantId, session.tenantId));
    await audit(tx, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "settings.mail_disconnected",
      subjectType: "tenant",
      subjectId: session.tenantId,
    });
  });
}

/** The watcher's health readout for the Settings screen. Best-effort; never throws. */
export async function recordMailStatus(tenantId: string, error: string | null): Promise<void> {
  try {
    await withTenant(tenantId, (tx) =>
      tx
        .update(tenantMailSettings)
        .set({ lastCheckedAt: new Date(), lastError: error ? error.slice(0, 300) : null })
        .where(eq(tenantMailSettings.tenantId, tenantId))
    );
  } catch {
    /* status only */
  }
}

async function openGrant(tenantId: string): Promise<{ provider: OAuthProvider; token: string } | null> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx.select().from(tenantMailSettings).where(eq(tenantMailSettings.tenantId, tenantId));
    return row && isOAuthProvider(row.provider) && row.oauthRefreshTokenEnc
      ? { provider: row.provider, token: await openSecret(tx, tenantId, row.oauthRefreshTokenEnc) }
      : null;
  });
}

/**
 * Save an inbox connected through the provider pop-up. Replaces whatever was
 * there before (an app password, or another account), and revokes a previous
 * OAuth grant so a superseded token cannot linger.
 */
export async function saveOAuthConnection(
  actor: { tenantId: string; userId: string },
  provider: OAuthProvider,
  conn: Connection
): Promise<void> {
  const previous = await openGrant(actor.tenantId);

  await withTenant(actor.tenantId, async (tx) => {
    const values = {
      provider,
      emailAddress: conn.account,
      oauthRefreshTokenEnc: await sealSecret(tx, actor.tenantId, conn.refreshToken),
      oauthScopes: conn.scopes,
      connectedBy: actor.userId,
      // This connection has no password or hosts.
      username: null,
      passwordEnc: null,
      imapHost: null,
      smtpHost: null,
      enabled: true,
      lastError: null,
      updatedAt: new Date(),
    };
    await tx
      .insert(tenantMailSettings)
      .values({ tenantId: actor.tenantId, ...values })
      .onConflictDoUpdate({ target: tenantMailSettings.tenantId, set: values });
    await audit(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "settings.mail_connected",
      subjectType: "tenant",
      subjectId: actor.tenantId,
      // The account and the scopes — never the token.
      after: { provider, account: conn.account, scopes: conn.scopes },
    });
  });

  if (previous && previous.token !== conn.refreshToken) await revokeGrant(previous.provider, previous.token);
}
