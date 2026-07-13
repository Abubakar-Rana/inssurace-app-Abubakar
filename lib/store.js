"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { SEED_REQUESTS, SIMULATED_POOL, buildCertificate } from "./seed";

const StoreContext = createContext(null);
const STORAGE_KEY = "certflow.state.v1";

function initialRequests() {
  return SEED_REQUESTS.map((r) => ({ ...r, certificate: null }));
}

export function StoreProvider({ children }) {
  const [requests, setRequests] = useState(initialRequests);
  const [simIndex, setSimIndex] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  // Load persisted state (client only)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.requests) setRequests(parsed.requests);
        if (typeof parsed.simIndex === "number") setSimIndex(parsed.simIndex);
      }
    } catch (e) {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ requests, simIndex }));
    } catch (e) {
      /* ignore */
    }
  }, [requests, simIndex, hydrated]);

  const api = useMemo(
    () => ({
      requests,
      hydrated,
      getRequest: (id) => requests.find((r) => r.id === id),

      // Runs the "auto-fetch + fill" — produces the certificate object.
      generateCertificate: (id) => {
        setRequests((prev) =>
          prev.map((r) =>
            r.id === id
              ? { ...r, status: "ready", certificate: r.certificate || buildCertificate(r) }
              : r
          )
        );
      },

      updateCertificate: (id, certificate) => {
        setRequests((prev) =>
          prev.map((r) => (r.id === id ? { ...r, certificate } : r))
        );
      },

      distribute: (id, method) => {
        setRequests((prev) =>
          prev.map((r) =>
            r.id === id
              ? {
                  ...r,
                  status: "distributed",
                  distribution: { method, at: "07/08/2026" },
                }
              : r
          )
        );
      },

      simulateIncoming: () => {
        const template = SIMULATED_POOL[simIndex % SIMULATED_POOL.length];
        const n = 1045 + simIndex;
        const newReq = {
          id: `REQ-${n}`,
          status: "new",
          priority: simIndex % 2 === 0 ? "high" : "normal",
          email: {
            ...template.email,
            receivedAt: "2026-07-08T14:30:00",
          },
          ams: { ...template.ams },
          certificate: null,
          justArrived: true,
        };
        setSimIndex((i) => i + 1);
        setRequests((prev) => [newReq, ...prev]);
        return newReq.id;
      },

      resetDemo: () => {
        setRequests(initialRequests());
        setSimIndex(0);
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch (e) {
          /* ignore */
        }
      },
    }),
    [requests, simIndex, hydrated]
  );

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
