"use client";

import AppShell from "@/components/AppShell";
import InboxView from "@/components/InboxView";
import { useStore } from "@/lib/store";

export default function HomePage() {
  const store = useStore();
  const inboxCount = store.requests.filter((r) => r.status === "new").length;
  return (
    <AppShell inboxCount={inboxCount}>
      <InboxView />
    </AppShell>
  );
}
