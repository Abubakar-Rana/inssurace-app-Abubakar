/**
 * "Connect your inbox" (Google / Microsoft OAuth) and the API mail transport.
 *
 * Pure: the network is replaced by a fake (setHttpForTests), no database is
 * touched, no real provider is contacted and no mail is sent.
 *
 *   npm run verify:mail-oauth
 */

import "@/lib/env";
import {
  beginAuthorization,
  completeAuthorization,
  missingScopes,
  openState,
  providerConfigured,
  sealState,
  setHttpForTests,
  MailAuthError,
} from "@/lib/mail/oauth";
import { composeMime, fetchViaApi, gmailThreadId, sendViaApi } from "@/lib/mail/api";
import { oauthResultPage } from "@/lib/mail/oauthPage";
import type { GmailConfig } from "@/lib/gmail/inbox";

process.env.SESSION_SECRET ??= "verify-mail-oauth-secret-at-least-32-chars";
process.env.APP_URL = "https://app.certflow.test";
process.env.GOOGLE_OAUTH_CLIENT_ID = "google-client";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "google-secret";
process.env.MICROSOFT_OAUTH_CLIENT_ID = "ms-client";
process.env.MICROSOFT_OAUTH_CLIENT_SECRET = "ms-secret";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}
async function throws(label: string, fn: () => Promise<unknown>, match?: RegExp) {
  try {
    await fn();
    check(label, false, "did not throw");
  } catch (err) {
    check(label, !match || match.test((err as Error).message), (err as Error).message);
  }
}

const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const idToken = (claims: Record<string, unknown>) =>
  `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;

type Call = { url: string; init?: RequestInit };
const calls: Call[] = [];
function fakeNetwork(handler: (url: string, init?: RequestInit) => { status?: number; json?: unknown; text?: string }) {
  setHttpForTests((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const r = handler(url, init);
    const body = r.text ?? JSON.stringify(r.json ?? {});
    return new Response(body, { status: r.status ?? 200 });
  }) as typeof fetch);
}

const SAMPLE_MIME = [
  "From: Dana Broker <dana@broker.example>",
  "To: coi@agency.example",
  "Subject: COI request for Smart Way Solutions",
  "Message-ID: <req-1@broker.example>",
  "Date: Mon, 21 Sep 2026 14:00:00 +0000",
  "",
  "Please send a certificate of insurance for Smart Way Solutions Inc.",
  "",
].join("\r\n");

async function main() {
  console.log("-- consent URL + state --");
  check("both providers configured from env", providerConfigured("google") && providerConfigured("microsoft"));

  const g = beginAuthorization("google", TENANT, USER);
  const gu = new URL(g.url);
  const gScopes = (gu.searchParams.get("scope") ?? "").split(" ");
  check("Google consent screen host", gu.host === "accounts.google.com");
  check("Google asks read + send", gScopes.includes("https://www.googleapis.com/auth/gmail.readonly") && gScopes.includes("https://www.googleapis.com/auth/gmail.send"));
  check("Google does NOT ask full mailbox access (mail.google.com / modify)", !gScopes.some((s) => /mail\.google\.com|gmail\.modify|gmail\.compose/.test(s)));
  check("Google: offline access + consent (refresh token)", gu.searchParams.get("access_type") === "offline" && gu.searchParams.get("prompt") === "consent");
  check("PKCE S256", gu.searchParams.get("code_challenge_method") === "S256" && (gu.searchParams.get("code_challenge") ?? "").length > 40);
  check("redirect URI is fixed on APP_URL", gu.searchParams.get("redirect_uri") === "https://app.certflow.test/api/mail/oauth/google/callback");
  check("the PKCE verifier is NOT in the URL", !g.url.includes(openState(g.cookieValue)!.verifier));

  const m = new URL(beginAuthorization("microsoft", TENANT, USER).url);
  const mScopes = (m.searchParams.get("scope") ?? "").split(" ");
  check("Microsoft asks Mail.Read + Mail.Send + offline_access", ["https://graph.microsoft.com/Mail.Read", "https://graph.microsoft.com/Mail.Send", "offline_access"].every((s) => mScopes.includes(s)));
  check("Microsoft does NOT ask Mail.ReadWrite", !mScopes.some((s) => /ReadWrite/i.test(s)));

  const st = openState(g.cookieValue);
  check("state round-trips (tenant, user, provider)", st?.tenantId === TENANT && st.userId === USER && st.provider === "google");
  check("state nonce in URL matches cookie", gu.searchParams.get("state") === st?.nonce);
  const [body, mac] = g.cookieValue.split(".");
  const forged = Buffer.from(JSON.stringify({ ...st, tenantId: "33333333-3333-3333-3333-333333333333" })).toString("base64url");
  check("tampered state refused", openState(`${forged}.${mac}`) === null);
  check("garbage state refused", openState("abc") === null && openState(undefined) === null);
  check("expired state refused", openState(sealState({ ...st!, exp: Date.now() - 1 })) === null);
  const { serializeSession, newClaims } = await import("@/lib/auth/cookie");
  check("a session cookie cannot pass as a state", openState(await serializeSession(newClaims(USER, TENANT))) === null);
  void body;

  console.log("\n-- granted scopes --");
  check("Google: all granted", missingScopes("google", "openid https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send email").length === 0);
  check("Google: send unticked is caught", missingScopes("google", "openid https://www.googleapis.com/auth/gmail.readonly").join() === "https://www.googleapis.com/auth/gmail.send");
  check("Microsoft short scope names accepted", missingScopes("microsoft", "Mail.Read Mail.Send User.Read openid profile email").length === 0);
  check("Microsoft full scope URLs accepted", missingScopes("microsoft", "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send").length === 0);
  check("Microsoft read-only grant is caught", missingScopes("microsoft", "Mail.Read openid").length === 1);

  console.log("\n-- code exchange --");
  fakeNetwork(() => ({
    json: {
      access_token: "at-google",
      refresh_token: "rt-google",
      expires_in: 3600,
      scope: "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
      id_token: idToken({ email: "Certificates@Agency.example" }),
    },
  }));
  const conn = await completeAuthorization("google", "code-1", st!);
  check("connected account read from id_token (lower-cased)", conn.account === "certificates@agency.example");
  check("refresh token returned for sealing", conn.refreshToken === "rt-google");
  const tokenCall = calls.at(-1)!;
  const sent = new URLSearchParams(String(tokenCall.init?.body));
  check("token call goes to Google's fixed endpoint", tokenCall.url === "https://oauth2.googleapis.com/token");
  check("token call carries the PKCE verifier", sent.get("code_verifier") === st!.verifier && sent.get("grant_type") === "authorization_code");

  fakeNetwork(() => ({ json: { access_token: "a", scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send", id_token: idToken({ email: "x@y.z" }) } }));
  await throws("no refresh token → refused", () => completeAuthorization("google", "c", st!), /ongoing access/);
  fakeNetwork(() => ({ json: { access_token: "a", refresh_token: "r", scope: "openid https://www.googleapis.com/auth/gmail.readonly", id_token: idToken({ email: "x@y.z" }) } }));
  await throws("send permission unticked → refused, nothing saved", () => completeAuthorization("google", "c", st!), /read and send/);
  fakeNetwork(() => ({ status: 400, json: { error: "invalid_grant", error_description: "secret-ish detail" } }));
  try {
    await completeAuthorization("google", "c", st!);
    check("revoked grant → MailAuthError(needsReconnect)", false);
  } catch (err) {
    check("revoked grant → MailAuthError(needsReconnect)", err instanceof MailAuthError && err.needsReconnect);
    check("provider's error description is not echoed", !(err as Error).message.includes("secret-ish"));
  }

  // Leave a cached access token for TENANT so the transport tests need no database.
  fakeNetwork(() => ({
    json: {
      access_token: "at-google",
      refresh_token: "rt-google",
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
      id_token: idToken({ email: "certificates@agency.example" }),
    },
  }));
  await completeAuthorization("google", "code-2", st!);

  console.log("\n-- reading mail (Gmail API) --");
  const gmailConfig: GmailConfig = {
    user: "certificates@agency.example",
    appPassword: "",
    fromAddress: "certificates@agency.example",
    oauth: { tenantId: TENANT, provider: "google" },
  };
  const OLD = Date.parse("2026-09-21T10:00:00Z");
  const NEW = Date.parse("2026-09-21T14:00:00Z");
  fakeNetwork((url) => {
    if (url.includes("/messages?")) return { json: { messages: [{ id: "m-new", threadId: "18c2f0e1a2b3c4d5" }, { id: "m-old", threadId: "t" }] } };
    if (url.includes("m-new?format=minimal")) return { json: { internalDate: String(NEW) } };
    if (url.includes("m-old?format=minimal")) return { json: { internalDate: String(OLD) } };
    if (url.includes("m-new?format=raw")) return { json: { raw: Buffer.from(SAMPLE_MIME).toString("base64url"), threadId: "18c2f0e1a2b3c4d5" } };
    return { status: 500 };
  });
  calls.length = 0;
  const got = await fetchViaApi(gmailConfig, { sinceUid: OLD, limit: 10 });
  check("only mail newer than the watermark is downloaded", got.emails.length === 1 && !calls.some((c) => c.url.includes("m-old?format=raw")));
  check("parsed like IMAP mail", got.emails[0]?.messageId === "<req-1@broker.example>" && got.emails[0].fromAddr === "dana@broker.example");
  check("Gmail thread id kept", got.emails[0]?.threadId === "18c2f0e1a2b3c4d5");
  check("watermark advances to newest", got.highestUid === NEW && got.uidValidity === "gmail-api");
  check("inbox only, read-only calls", calls.every((c) => !c.init?.method || c.init.method === "GET") && calls[0].url.includes(encodeURIComponent("in:inbox")));
  check("bearer token used, never a password", calls.every((c) => (c.init?.headers as Record<string, string>)?.Authorization === "Bearer at-google"));

  fakeNetwork(() => ({ status: 403, json: {} }));
  try {
    await fetchViaApi(gmailConfig, { limit: 1 });
    check("403 from Gmail → needs reconnect", false);
  } catch (err) {
    check("403 from Gmail → needs reconnect", err instanceof MailAuthError && err.needsReconnect);
  }

  console.log("\n-- reading mail (Microsoft Graph) --");
  const msTenant = "44444444-4444-4444-4444-444444444444";
  fakeNetwork(() => ({
    json: {
      access_token: "at-ms",
      refresh_token: "rt-ms",
      expires_in: 3600,
      scope: "Mail.Read Mail.Send openid",
      id_token: idToken({ preferred_username: "coi@agency365.example" }),
    },
  }));
  const msConn = await completeAuthorization("microsoft", "c", { ...st!, tenantId: msTenant, provider: "microsoft" });
  check("Microsoft account from preferred_username", msConn.account === "coi@agency365.example");
  const graphConfig: GmailConfig = { user: msConn.account, appPassword: "", fromAddress: msConn.account, oauth: { tenantId: msTenant, provider: "microsoft" } };
  fakeNetwork((url) => {
    if (url.includes("/mailFolders/inbox/messages?")) return { json: { value: [{ id: "AAMk=1", receivedDateTime: "2026-09-21T14:00:00Z", conversationId: "conv-1" }] } };
    if (url.includes("/$value")) return { text: SAMPLE_MIME };
    return { status: 500 };
  });
  calls.length = 0;
  const gg = await fetchViaApi(graphConfig, { limit: 5 });
  check("Graph message read as raw MIME", gg.emails[0]?.subject === "COI request for Smart Way Solutions" && gg.emails[0].threadId === "conv-1");
  check("Graph message id is URL-encoded", calls.some((c) => c.url.includes("AAMk%3D1/$value")));
  check("Graph reads the inbox folder only", calls[0].url.includes("/mailFolders/inbox/messages"));

  console.log("\n-- sending --");
  const mime = (await composeMime({
    from: "certificates@agency.example",
    to: "dana@broker.example",
    subject: "Re: COI request",
    text: "Please find attached.",
    inReplyTo: "<req-1@broker.example>",
    references: ["<req-1@broker.example>"],
    headers: { "X-CertFlow-Auto": "certificate" },
    attachments: [{ filename: "COI.pdf", content: Buffer.from("%PDF-1.4"), contentType: "application/pdf" }],
  })).raw.toString();
  check("reply threads: In-Reply-To + References", /In-Reply-To: <req-1@broker\.example>/.test(mime) && /References: <req-1@broker\.example>/.test(mime));
  // Header names are case-insensitive (the composer writes "X-Certflow-Auto").
  check("self-detection stamp kept", /^X-CertFlow-Auto: certificate$/im.test(mime));
  const { parseRawEmail } = await import("@/lib/gmail/inbox");
  const echoed = await parseRawEmail(mime, { fallbackId: "x", threadId: null });
  check("our own reply is recognised as ours when it comes back", echoed?.autoGenerated === true);
  check("PDF attached", /filename=COI\.pdf/.test(mime) && /application\/pdf/.test(mime));
  check("From is the connected account", /From: certificates@agency\.example/.test(mime));

  check("Gmail thread id: API hex kept", gmailThreadId("18c2f0e1a2b3c4d5") === "18c2f0e1a2b3c4d5");
  check("Gmail thread id: IMAP decimal converted", gmailThreadId("1783456789012345678") === BigInt("1783456789012345678").toString(16));
  check("Gmail thread id: junk ignored", gmailThreadId("conv-1") === undefined && gmailThreadId(null) === undefined);

  fakeNetwork(() => ({ json: { id: "x", threadId: "18c2f0e1a2b3c4d5" } }));
  calls.length = 0;
  await sendViaApi(gmailConfig, { from: gmailConfig.fromAddress!, to: "dana@broker.example", subject: "Re: x", text: "hi", threadId: "18c2f0e1a2b3c4d5" });
  const gsend = JSON.parse(String(calls[0].init?.body));
  check("Gmail send: POST messages/send", calls[0].url.endsWith("/users/me/messages/send") && calls[0].init?.method === "POST");
  check("Gmail send: raw MIME + thread id", Buffer.from(gsend.raw, "base64url").toString().includes("To: dana@broker.example") && gsend.threadId === "18c2f0e1a2b3c4d5");

  fakeNetwork(() => ({ status: 202, text: "" }));
  calls.length = 0;
  await sendViaApi(graphConfig, { from: graphConfig.fromAddress!, to: "dana@broker.example", subject: "Re: x", text: "hi" });
  check("Graph send: POST /me/sendMail with base64 MIME", calls[0].url.endsWith("/me/sendMail") && Buffer.from(String(calls[0].init?.body), "base64").toString().includes("To: dana@broker.example"));

  console.log("\n-- the pop-up result page --");
  const page = oauthResultPage({ ok: false, message: `<script>alert(1)</script>` });
  const html = await page.text();
  check("message is HTML-escaped", !html.includes("<script>alert(1)</script>") && html.includes("&lt;script&gt;"));
  check("strict CSP", (page.headers.get("content-security-policy") ?? "").includes("default-src 'none'"));
  check("result posted to OUR origin only", html.includes("postMessage(m,location.origin)"));
  check("state cookie cleared", /certflow_mail_oauth=;/.test(page.headers.get("set-cookie") ?? ""));

  setHttpForTests(null);
  console.log(failures ? `\n${failures} check(s) FAILED.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
