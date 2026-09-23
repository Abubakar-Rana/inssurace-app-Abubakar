/**
 * Mail over the providers' own APIs, for inboxes connected by OAuth:
 * Gmail API for Google, Microsoft Graph for Outlook / Microsoft 365.
 *
 * Deliberately thin. Both directions move RAW RFC 822 messages:
 *   in:  the provider hands us the original MIME, which goes through the same
 *        parseRawEmail() as IMAP mail — ingestion cannot tell the difference
 *   out: we compose the MIME ourselves (nodemailer's composer), so In-Reply-To,
 *        References and the X-CertFlow-Auto stamp are exactly what the SMTP
 *        path sends
 *
 * READ-ONLY on the inbox: only list and get. Nothing here can modify, label,
 * move or delete mail — and the scopes granted could not do it anyway.
 *
 * The incremental watermark is the received time (epoch ms) of the newest
 * message seen. It is an optimisation only; the unique index on
 * (tenant, message id) is what makes re-reading a message harmless.
 */

import { randomUUID } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer";
import { parseRawEmail, type FetchOptions, type FetchResult, type GmailConfig, type InboundEmail } from "@/lib/gmail/inbox";
import { accessTokenFor, forgetAccessToken, httpFetch, MailAuthError, type OAuthProvider } from "./oauth";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const GRAPH = "https://graph.microsoft.com/v1.0/me";

function oauthOf(config: GmailConfig): { tenantId: string; provider: OAuthProvider } {
  if (!config.oauth) throw new Error("Not an OAuth mailbox.");
  return config.oauth;
}

/** Authenticated request with one retry on 401 (an access token revoked early). */
async function api(config: GmailConfig, url: string, init: RequestInit = {}): Promise<Response> {
  const { tenantId, provider } = oauthOf(config);
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessTokenFor(tenantId, provider);
    const res = await httpFetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 && attempt === 0) {
      forgetAccessToken(tenantId);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new MailAuthError(
        `${provider === "google" ? "Google" : "Microsoft"} refused access to this inbox. Reconnect it in Settings → Email.`,
        true
      );
    }
    if (!res.ok) throw new Error(`${provider} mail API ${res.status}`);
    return res;
  }
  throw new MailAuthError("Mail access was refused.", true);
}

// ---------------------------------------------------------------- read

export async function fetchViaApi(config: GmailConfig, options: FetchOptions = {}): Promise<FetchResult> {
  return config.oauth!.provider === "google" ? fetchGmail(config, options) : fetchGraph(config, options);
}

async function fetchGmail(config: GmailConfig, options: FetchOptions): Promise<FetchResult> {
  const limit = options.limit ?? 25;
  const sinceMs = options.sinceUid ?? (options.since ?? new Date(Date.now() - 30 * 86_400_000)).getTime();
  // `after:` has one-second granularity; step back a second and filter exactly below.
  const q = `in:inbox after:${Math.max(0, Math.floor(sinceMs / 1000) - 1)}`;
  const list = (await (await api(config, `${GMAIL}/messages?${new URLSearchParams({ q, maxResults: String(limit) })}`)).json()) as {
    messages?: { id: string; threadId: string }[];
  };

  const emails: InboundEmail[] = [];
  let highest = options.sinceUid ?? 0;
  for (const m of list.messages ?? []) {
    // Cheap check first; download the full message only when it is new.
    const meta = (await (await api(config, `${GMAIL}/messages/${m.id}?format=minimal`)).json()) as { internalDate?: string };
    const at = Number(meta.internalDate ?? 0);
    if (options.sinceUid && at <= options.sinceUid) continue;
    const full = (await (await api(config, `${GMAIL}/messages/${m.id}?format=raw`)).json()) as { raw?: string; threadId?: string };
    if (!full.raw) continue;
    const email = await parseRawEmail(Buffer.from(full.raw, "base64url"), {
      fallbackId: `gmail-${m.id}@${config.user}`,
      threadId: full.threadId ?? m.threadId ?? null,
      receivedAt: new Date(at),
    });
    if (email) emails.push(email);
    if (at > highest) highest = at;
  }
  return { emails, uidValidity: "gmail-api", highestUid: highest };
}

async function fetchGraph(config: GmailConfig, options: FetchOptions): Promise<FetchResult> {
  const limit = options.limit ?? 25;
  const sinceMs = options.sinceUid ?? (options.since ?? new Date(Date.now() - 30 * 86_400_000)).getTime();
  const params = new URLSearchParams({
    $select: "id,receivedDateTime,conversationId",
    $filter: `receivedDateTime gt ${new Date(sinceMs).toISOString()}`,
    $orderby: "receivedDateTime desc",
    $top: String(limit),
  });
  const list = (await (await api(config, `${GRAPH}/mailFolders/inbox/messages?${params}`)).json()) as {
    value?: { id: string; receivedDateTime: string; conversationId?: string }[];
  };

  const emails: InboundEmail[] = [];
  let highest = options.sinceUid ?? 0;
  for (const m of list.value ?? []) {
    const at = Date.parse(m.receivedDateTime);
    if (options.sinceUid && at <= options.sinceUid) continue;
    const mime = await (await api(config, `${GRAPH}/messages/${encodeURIComponent(m.id)}/$value`)).text();
    const email = await parseRawEmail(mime, {
      fallbackId: `graph-${m.id}@${config.user}`,
      threadId: m.conversationId ?? null,
      receivedAt: new Date(at),
    });
    if (email) emails.push(email);
    if (at > highest) highest = at;
  }
  return { emails, uidValidity: "graph", highestUid: highest };
}

// ---------------------------------------------------------------- send

export interface ApiMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
  headers?: Record<string, string>;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
  /** Provider thread to file our reply under in the SENDER's mailbox (Gmail only). */
  threadId?: string | null;
}

/** Compose the exact MIME we would have sent over SMTP. */
export async function composeMime(m: ApiMessage): Promise<{ raw: Buffer; messageId: string }> {
  const domain = m.from.split("@")[1] || "certflow.local";
  const messageId = `<${randomUUID()}@${domain}>`;
  const raw = await new MailComposer({
    from: m.from,
    to: m.to,
    subject: m.subject,
    text: m.text,
    messageId,
    inReplyTo: m.inReplyTo,
    references: m.references,
    headers: m.headers,
    attachments: m.attachments,
  })
    .compile()
    .build();
  return { raw, messageId };
}

/**
 * Gmail thread ids differ by transport: the API uses hex ("18c2f0e1a2b3c4d5"),
 * IMAP's X-GM-THRID is the same number in decimal. Accept either.
 */
export function gmailThreadId(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (/^\d{17,20}$/.test(value)) {
    try {
      return BigInt(value).toString(16);
    } catch {
      return undefined;
    }
  }
  return /^[0-9a-f]{1,16}$/i.test(value) ? value.toLowerCase() : undefined;
}

export async function sendViaApi(config: GmailConfig, m: ApiMessage): Promise<{ messageId: string }> {
  const { raw, messageId } = await composeMime(m);
  if (config.oauth!.provider === "google") {
    const threadId = gmailThreadId(m.threadId);
    await api(config, `${GMAIL}/messages/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw: raw.toString("base64url"), ...(threadId ? { threadId } : {}) }),
    });
  } else {
    // Graph accepts a whole MIME message, base64-encoded, as text/plain.
    await api(config, `${GRAPH}/sendMail`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: raw.toString("base64"),
    });
  }
  return { messageId };
}
