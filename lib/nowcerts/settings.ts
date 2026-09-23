/**
 * The NowCerts connection an agency manages in Settings → Data source.
 * Same rules as the mail settings: the password is sealed with the agency's
 * key, never returned, and every change is audited without it.
 */

import { eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { tenantNowcertsSettings, tenants } from "@/db/schema";
import { audit } from "@/lib/audit";
import { openSecret, sealSecret } from "@/lib/crypto/tenantSecrets";
import { ServiceError } from "@/lib/certificate/service";
import { call, forgetToken, NowCertsError, rows, type Credentials } from "./client";

export interface NowcertsSettingsView {
  dataSource: "certflow" | "nowcerts";
  configured: boolean;
  username: string;
  passwordSet: boolean;
  enabled: boolean;
  syncIntervalMinutes: number;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  lastSyncStats: Record<string, number> | null;
}

export async function getNowcertsView(tenantId: string): Promise<NowcertsSettingsView> {
  return withTenant(tenantId, async (tx) => {
    const [tenant] = await tx.select({ dataSource: tenants.dataSource }).from(tenants).where(eq(tenants.id, tenantId));
    const [row] = await tx.select().from(tenantNowcertsSettings).where(eq(tenantNowcertsSettings.tenantId, tenantId));
    return {
      dataSource: tenant?.dataSource === "nowcerts" ? "nowcerts" : "certflow",
      configured: Boolean(row),
      username: row?.username ?? "",
      passwordSet: Boolean(row?.passwordEnc),
      enabled: row?.enabled ?? true,
      syncIntervalMinutes: row?.syncIntervalMinutes ?? 30,
      lastSyncAt: row?.lastSyncAt?.toISOString() ?? null,
      lastSyncStatus: row?.lastSyncStatus ?? null,
      lastSyncError: row?.lastSyncError ?? null,
      lastSyncStats: row?.lastSyncStats ?? null,
    };
  });
}

/** Sign in and read one page of policies. Proves the login works; writes nothing. */
export async function testNowcerts(c: Credentials): Promise<string> {
  try {
    forgetToken(c);
    const data = await call(c, "GET", "PolicyDetailList", { query: { isActive: "true", $top: "1", $count: "true" } });
    const count = (data as { "@odata.count"?: number })?.["@odata.count"];
    return typeof count === "number"
      ? `Connected. NowCerts reports ${count} active polic${count === 1 ? "y" : "ies"}.`
      : `Connected. Read ${rows(data).length} sample polic${rows(data).length === 1 ? "y" : "ies"}.`;
  } catch (err) {
    if (err instanceof NowCertsError) throw new ServiceError(err.message, 422);
    throw new ServiceError("Could not reach NowCerts. Try again in a minute.", 502);
  }
}

export interface NowcertsInput {
  username?: unknown;
  password?: unknown;
  enabled?: unknown;
  syncIntervalMinutes?: unknown;
  dataSource?: unknown;
}

export async function saveNowcerts(
  session: { tenantId: string; userId: string },
  input: NowcertsInput,
  opts: { test: boolean }
): Promise<{ message?: string }> {
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const newPassword = typeof input.password === "string" ? input.password : "";
  if (!username) throw new ServiceError("Enter the NowCerts API username.");
  if (newPassword.length > 256) throw new ServiceError("That password is too long.");
  const interval = Math.min(24 * 60, Math.max(15, Number(input.syncIntervalMinutes) || 30));
  const dataSource = input.dataSource === "nowcerts" ? "nowcerts" : input.dataSource === "certflow" ? "certflow" : undefined;

  const stored = await withTenant(session.tenantId, async (tx) => {
    const [row] = await tx.select().from(tenantNowcertsSettings).where(eq(tenantNowcertsSettings.tenantId, session.tenantId));
    return row ? openSecret(tx, session.tenantId, row.passwordEnc) : null;
  });
  const password = newPassword || stored;
  if (!password) throw new ServiceError("Enter the NowCerts API password.");

  const message = opts.test ? await testNowcerts({ tenantId: session.tenantId, username, password }) : undefined;

  await withTenant(session.tenantId, async (tx) => {
    const values = {
      username,
      passwordEnc: await sealSecret(tx, session.tenantId, password),
      enabled: input.enabled === undefined ? true : input.enabled === true,
      syncIntervalMinutes: interval,
      updatedAt: new Date(),
    };
    await tx
      .insert(tenantNowcertsSettings)
      .values({ tenantId: session.tenantId, ...values })
      .onConflictDoUpdate({ target: tenantNowcertsSettings.tenantId, set: values });
    if (dataSource) await tx.update(tenants).set({ dataSource }).where(eq(tenants.id, session.tenantId));
    await audit(tx, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "settings.nowcerts_saved",
      subjectType: "tenant",
      subjectId: session.tenantId,
      after: { username, enabled: values.enabled, syncIntervalMinutes: interval, dataSource, passwordChanged: Boolean(newPassword) },
    });
  });
  return { message };
}

/** Switch the agency's data source without touching credentials. */
export async function setDataSource(session: { tenantId: string; userId: string }, value: unknown): Promise<void> {
  if (value !== "certflow" && value !== "nowcerts") throw new ServiceError("Data source must be certflow or nowcerts.");
  await withTenant(session.tenantId, async (tx) => {
    if (value === "nowcerts") {
      const [row] = await tx.select({ t: tenantNowcertsSettings.tenantId }).from(tenantNowcertsSettings);
      if (!row) throw new ServiceError("Connect NowCerts first, then switch to it.");
    }
    await tx.update(tenants).set({ dataSource: value }).where(eq(tenants.id, session.tenantId));
    await audit(tx, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "settings.data_source",
      subjectType: "tenant",
      subjectId: session.tenantId,
      after: { dataSource: value },
    });
  });
}

export async function disconnectNowcerts(session: { tenantId: string; userId: string }): Promise<void> {
  await withTenant(session.tenantId, async (tx) => {
    await tx.delete(tenantNowcertsSettings).where(eq(tenantNowcertsSettings.tenantId, session.tenantId));
    await tx.update(tenants).set({ dataSource: "certflow" }).where(eq(tenants.id, session.tenantId));
    await audit(tx, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "settings.nowcerts_disconnected",
      subjectType: "tenant",
      subjectId: session.tenantId,
    });
  });
}
