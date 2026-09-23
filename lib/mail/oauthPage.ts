/**
 * The tiny page the OAuth pop-up lands on. It tells the Settings screen that
 * opened it how things went, then closes itself.
 *
 * It carries a yes/no and a short, already-safe message — never a token, an
 * account id or anything from the provider's redirect. `postMessage` targets
 * our own origin only, so no other window can read the result. With no opener
 * (pop-ups blocked, so the flow ran in the main tab) it goes to Settings instead.
 */

import { NextResponse } from "next/server";

export const STATE_COOKIE = "certflow_mail_oauth";

export function stateCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax, not Strict: the provider redirects back cross-site, and a Strict
    // cookie would not come with it. It holds only the signed state.
    sameSite: "lax" as const,
    path: "/api/mail/oauth",
    maxAge: 600,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function oauthResultPage(result: { ok: boolean; message: string }, status = 200): NextResponse {
  const payload = JSON.stringify({ type: "certflow-mail-oauth", ok: result.ok, message: result.message }).replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>CertFlow</title>
<style>body{font:14px system-ui,sans-serif;color:#141b2d;display:flex;min-height:90vh;align-items:center;justify-content:center;margin:0;background:#f7f8fa}
div{max-width:360px;padding:24px;border-radius:16px;background:#fff;box-shadow:0 1px 3px rgba(20,27,45,.08);text-align:center}
b{display:block;margin-bottom:6px;font-size:15px;color:${result.ok ? "#047857" : "#b91c1c"}}</style></head>
<body><div><b>${result.ok ? "Inbox connected" : "Could not connect"}</b>${escapeHtml(result.message)}<p style="color:#64748b;font-size:12px">You can close this window.</p></div>
<script>
(function(){var m=${payload};
try{if(window.opener&&!window.opener.closed){window.opener.postMessage(m,location.origin);setTimeout(function(){window.close()},${result.ok ? 600 : 4000});return;}}catch(e){}
setTimeout(function(){location.replace("/settings?tab=email&mail="+(m.ok?"connected":"failed"))},${result.ok ? 800 : 4000});})();
</script></body></html>`;
  const res = new NextResponse(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // Only this page's own inline script and style; nothing loads from anywhere.
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
  // Single use: whatever happened, the state is spent.
  res.cookies.set(STATE_COOKIE, "", { ...stateCookieOptions(), maxAge: 0 });
  return res;
}
