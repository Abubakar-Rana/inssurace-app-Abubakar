"use client";

// Client-side state for the dashboard.
//
// This used to keep everything in localStorage against hard-coded seed data.
// It is now a thin cache over the API — the database is the only source of
// truth, and nothing survives a reload that the server did not agree to.
//
// Deliberately no optimistic updates on write: certificate operations either
// commit and return the row, or fail. A reviewer must never see an "approved"
// badge for something that did not actually get recorded.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const StoreContext = createContext(null);
const SIGNIN = "/signin";

/**
 * Pages where there is no agency data to load: signing in, replacing a
 * temporary password (every data route refuses until that is done), and the
 * Nestnic console, which has a different session altogether. Fetching there
 * would only produce a redirect loop or a stream of refusals.
 */
function noAgencyData() {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname;
  return (
    path === "/" || // the public landing page
    path === SIGNIN ||
    path.startsWith("/welcome") ||
    path.startsWith("/signup") ||
    path.startsWith("/account/") ||
    path === "/admin" ||
    path.startsWith("/admin/")
  );
}

async function api(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  // The session expired or was revoked mid-visit. Bounce to sign-in rather than
  // showing an error the reviewer can do nothing about.
  //
  // The pathname guard is load-bearing: without it, signing out lands on
  // /signin, the provider remounts and fetches, gets 401, and redirects to
  // /signin again — an infinite loop that pins the browser.
  if (res.status === 401 && typeof window !== "undefined" && !noAgencyData()) {
    window.location.href = SIGNIN;
    throw new Error("Signed out.");
  }

  if (!res.ok) {
    // The status rides along on the error: a caller retrying on a timer needs to
    // tell "the mailbox is briefly unreachable" from "this account may not do
    // that", and only one of those is worth trying again.
    const err = new Error(body?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

export async function signOut() {
  await fetch("/api/auth/session", { method: "DELETE" });
  window.location.href = "/signin";
}

/**
 * The inbox row shape the UI renders.
 *
 * `status` is the request's own lifecycle, straight from the database:
 *   new -> ready (draft assembled) -> approved (issued) -> sent (delivered)
 */
function toRequestView(row) {
  return {
    id: row.id,
    reference: `REQ-${row.id.slice(0, 8).toUpperCase()}`,
    status: row.status,
    from: row.fromAddr,
    fromName: row.fromName || row.fromAddr,
    subject: row.subject || "(no subject)",
    receivedAt: row.receivedAt,
    insuredName: row.insuredName,
    clientNumber: row.clientNumber,
    matchConfidence: row.matchConfidence,
    certificateId: row.certificateId,
    certificateStatus: row.certificateStatus,
    viewedAt: row.viewedAt ?? null,
    // Null means nobody has opened it yet. This is what the dashboard counts.
    unread: !row.viewedAt,
  };
}

export function StoreProvider({ children }) {
  const [requests, setRequests] = useState([]);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState(null);
  const [live, setLive] = useState("connecting");
  const [lastEvent, setLastEvent] = useState(null);

  const refresh = useCallback(async () => {
    // The provider wraps the whole app, including the sign-in page, where there
    // is by definition no session to fetch with.
    if (noAgencyData()) {
      setHydrated(true);
      return;
    }
    try {
      const { requests } = await api("/api/requests");
      setRequests(requests.map(toRequestView));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * The live feed, owned here rather than by a view.
   *
   * The server watches the mailbox and announces when something lands, so
   * nothing polls it and there is no button. This lives in the store because
   * the store owns `refresh`, and because two mounted views must not open two
   * connections — the shell shows the connection state while the inbox shows
   * the requests, and both read the one feed.
   *
   * The message carries no certificate data, only "something changed". The
   * refresh then goes through the normal authenticated route, so this
   * connection cannot become a way to read rows that route would refuse.
   */
  useEffect(() => {
    if (noAgencyData()) return;

    const source = new EventSource("/api/events");
    source.onopen = () => setLive("live");
    source.onmessage = (message) => {
      setLive("live");
      let event;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      if (event.type !== "requests.changed") return;
      refresh();
      // Views decide what to say about it; the store only reports that it
      // happened, and `at` is what makes two identical events distinguishable.
      if (event.inserted > 0) setLastEvent({ inserted: event.inserted, at: Date.now() });
    };
    // EventSource retries by itself; this only reflects the current state, so
    // a dropped feed cannot look like a quiet mailbox.
    source.onerror = () => setLive("offline");

    return () => source.close();
  }, [refresh]);

  /**
   * A slow safety refresh.
   *
   * Everything above depends on one connection. If it is lost in a way
   * EventSource does not notice, or the server restarts between events, this
   * stops the screen sitting stale indefinitely. It refreshes the request list
   * only — it never touches the mailbox.
   */
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const value = useMemo(
    () => ({
      requests,
      hydrated,
      error,
      /** "connecting" | "live" | "offline" — whether this screen is current. */
      live,
      /** `{ inserted, at }` for the last arrival, or null. */
      lastEvent,
      /** Requests nobody has opened yet. The shell and the inbox share it. */
      unreadCount: requests.filter((r) => r.unread).length,
      refresh,
      getRequest: (id) => requests.find((r) => r.id === id),

      /** Assemble a draft from the database. Returns the certificate record. */
      generateCertificate: async (requestId) => {
        const { certificate } = await api(`/api/requests/${requestId}/certificate`, {
          method: "POST",
        });
        await refresh();
        return certificate;
      },

      getCertificate: async (certificateId) => {
        const { certificate } = await api(`/api/certificates/${certificateId}`);
        return certificate;
      },

      /** Save reviewer edits to a draft. */
      updateCertificate: async (certificateId, snapshot) => {
        const { certificate } = await api(`/api/certificates/${certificateId}`, {
          method: "PATCH",
          body: JSON.stringify({ snapshot }),
        });
        return certificate;
      },

      /** Human sign-off. Does NOT send anything. */
      approveCertificate: async (certificateId) => {
        const { certificate } = await api(`/api/certificates/${certificateId}/approve`, {
          method: "POST",
        });
        await refresh();
        return certificate;
      },

      certificatePdfUrl: (certificateId) => `/api/certificates/${certificateId}/pdf`,

      /** Email the issued certificate as a reply to the original request. */
      sendCertificate: async (certificateId, to) => {
        const { delivery } = await api(`/api/certificates/${certificateId}/send`, {
          method: "POST",
          body: JSON.stringify(to ? { to } : {}),
        });
        await refresh();
        return delivery;
      },

      listDeliveries: async (certificateId) => {
        const { deliveries } = await api(`/api/certificates/${certificateId}/send`);
        return deliveries;
      },

      listCertificates: async () => {
        const { certificates } = await api("/api/certificates");
        return certificates;
      },

      /**
       * Fetch new mail and interpret it. Safe to call repeatedly — the server
       * coalesces concurrent callers and reads the mailbox at most once every
       * few seconds, so a timer here costs nothing when nothing has changed.
       */
      pollGmail: async (days = 7) => {
        const { result } = await api("/api/gmail/poll", {
          method: "POST",
          body: JSON.stringify({ days }),
        });
        await refresh();
        return result;
      },

      /**
       * Record that a reviewer has opened this request, clearing it from the
       * unread count. Never throws at the caller: failing to mark something as
       * read must not stop the reviewer reaching the certificate.
       */
      markViewed: async (requestId) => {
        try {
          await api(`/api/requests/${requestId}/viewed`, { method: "POST" });
          await refresh();
        } catch {
          /* not worth interrupting the reviewer over */
        }
      },

      /** Mail the filter passed over recently, so a wrong skip stays findable. */
      recentlyIgnored: async () => {
        const { ignored } = await api("/api/gmail/activity");
        return ignored;
      },

      /** What the machine saw for a request — evidence for a human deciding. */
      getMatchContext: async (requestId) => api(`/api/requests/${requestId}/match`),

      searchClients: async (q) => {
        const { clients } = await api(`/api/clients?q=${encodeURIComponent(q ?? "")}`);
        return clients;
      },

      /** A human assigns the insured the resolver would not commit to. */
      matchRequest: async (requestId, clientId) => {
        const result = await api(`/api/requests/${requestId}/match`, {
          method: "POST",
          body: JSON.stringify({ clientId }),
        });
        await refresh();
        return result;
      },
    }),
    [requests, hydrated, error, live, lastEvent, refresh]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
