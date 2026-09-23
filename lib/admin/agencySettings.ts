/**
 * Agency-level settings an agency admin owns: the PRODUCER block printed on
 * every certificate, and the auto-send switch. (Mail and NowCerts live in
 * their own modules because they hold secrets.)
 */

import { and, eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { producers, tenants } from "@/db/schema";
import { audit } from "@/lib/audit";
import { ServiceError } from "@/lib/certificate/service";

type Actor = { tenantId: string; userId: string };

export async function getAgencyOverview(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const [producer] = await tx.select().from(producers).where(eq(producers.isDefault, true)).limit(1);
    return {
      agency: {
        name: tenant?.name ?? "",
        autoSend: tenant?.autoSend ?? false,
        dataSource: tenant?.dataSource ?? "certflow",
        allowUserManagement: tenant?.allowUserManagement ?? false,
      },
      producer: {
        name: producer?.name ?? "",
        addressLines: producer?.addressLines ?? "",
        contactName: producer?.contactName ?? "",
        phone: producer?.phone ?? "",
        fax: producer?.fax ?? "",
        email: producer?.email ?? "",
      },
    };
  });
}

function field(v: unknown, max: number, what: string, required = false): string {
  const s = typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "";
  if (required && !s) throw new ServiceError(`${what} is required.`);
  if (s.length > max) throw new ServiceError(`${what} is too long (max ${max} characters).`);
  return s;
}

/** The PRODUCER box: the agency as it appears on its own certificates. */
export async function saveProducer(actor: Actor, input: Record<string, unknown>) {
  const values = {
    name: field(input.name, 120, "Agency name", true),
    addressLines: field(input.addressLines, 200, "Address", true),
    contactName: field(input.contactName, 80, "Contact name") || null,
    phone: field(input.phone, 30, "Phone") || null,
    fax: field(input.fax, 30, "Fax") || null,
    email: field(input.email, 120, "Email") || null,
  };
  // The producer box holds the name plus three address lines.
  if (values.addressLines.split("\n").length > 3) {
    throw new ServiceError("Keep the address to 3 lines — the certificate's producer box has no room for more.");
  }

  await withTenant(actor.tenantId, async (tx) => {
    const [existing] = await tx.select({ id: producers.id }).from(producers).where(eq(producers.isDefault, true)).limit(1);
    if (existing) {
      await tx.update(producers).set(values).where(and(eq(producers.id, existing.id)));
    } else {
      await tx.insert(producers).values({ tenantId: actor.tenantId, isDefault: true, ...values });
    }
    await audit(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "settings.producer_saved",
      subjectType: "tenant",
      subjectId: actor.tenantId,
      after: { name: values.name },
    });
  });
}

export async function setAutoSend(actor: Actor, value: unknown) {
  if (typeof value !== "boolean") throw new ServiceError("autoSend must be true or false.");
  await withTenant(actor.tenantId, async (tx) => {
    await tx.update(tenants).set({ autoSend: value }).where(eq(tenants.id, actor.tenantId));
    await audit(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: value ? "settings.auto_send_on" : "settings.auto_send_off",
      subjectType: "tenant",
      subjectId: actor.tenantId,
    });
  });
}
