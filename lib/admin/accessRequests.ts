/**
 * "Request access" enquiries from the public marketing page.
 *
 * THIS CREATES NO ACCOUNT AND NO ACCESS. It records an enquiry for Nestnic to
 * read. Approving one opens the normal `createAgency` path, where a human
 * decides the name, the first admin and the switches.
 *
 * It is the only endpoint in CertFlow that an anonymous visitor can write to,
 * so it is deliberately narrow: short, validated fields, one enquiry per email
 * per day, a handful per IP per hour, and a honeypot field that real people
 * never fill in. Nothing here is ever rendered as HTML by the console without
 * escaping, and no reply is sent, so it cannot be used to mail anyone.
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accessRequests, tenants } from "@/db/schema";
import { ServiceError } from "@/lib/certificate/service";

const MAX_PER_IP_PER_HOUR = 5;
const LIMITS = { agencyName: 120, contactName: 120, email: 254, phone: 40, message: 1000 };

function field(value: unknown, key: keyof typeof LIMITS, label: string, required = true): string {
  const s = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!s) {
    if (required) throw new ServiceError(`${label} is required.`);
    return "";
  }
  if (s.length > LIMITS[key]) throw new ServiceError(`${label} is too long (max ${LIMITS[key]} characters).`);
  return s;
}

export interface AccessRequestInput {
  agencyName?: unknown;
  contactName?: unknown;
  email?: unknown;
  phone?: unknown;
  message?: unknown;
  /** Hidden field. A real person leaves it empty; bots fill everything in. */
  website?: unknown;
}

export async function submitAccessRequest(input: AccessRequestInput, meta: { ip: string | null; userAgent: string | null }) {
  // Silently accepted, never stored: telling a bot it was caught only helps it.
  if (typeof input.website === "string" && input.website.trim()) return { ok: true as const };

  const agencyName = field(input.agencyName, "agencyName", "Agency name");
  const contactName = field(input.contactName, "contactName", "Your name");
  const email = field(input.email, "email", "Work email").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ServiceError("Enter a valid work email address.");
  const phone = field(input.phone, "phone", "Phone", false);
  const message = field(input.message, "message", "Message", false);

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [{ recent }] = await db
    .select({ recent: sql<number>`count(*)::int` })
    .from(accessRequests)
    .where(and(eq(accessRequests.ip, meta.ip ?? ""), gte(accessRequests.createdAt, hourAgo)));
  if (meta.ip && recent >= MAX_PER_IP_PER_HOUR) {
    throw new ServiceError("Too many requests from this network. Please try again later, or email us directly.", 429);
  }

  const [duplicate] = await db
    .select({ id: accessRequests.id })
    .from(accessRequests)
    .where(and(eq(accessRequests.email, email), gte(accessRequests.createdAt, dayAgo)));
  // Not an error: a second click should not look like a failure.
  if (duplicate) return { ok: true as const };

  await db.insert(accessRequests).values({
    agencyName,
    contactName,
    email,
    phone: phone || null,
    message: message || null,
    ip: meta.ip,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  console.log(`[access-request] ${agencyName} <${email}>`);
  return { ok: true as const };
}

export async function listAccessRequests(status?: string) {
  return db
    .select({
      id: accessRequests.id,
      agencyName: accessRequests.agencyName,
      contactName: accessRequests.contactName,
      email: accessRequests.email,
      phone: accessRequests.phone,
      message: accessRequests.message,
      status: accessRequests.status,
      createdAt: accessRequests.createdAt,
      tenantId: accessRequests.tenantId,
      tenantName: tenants.name,
    })
    .from(accessRequests)
    .leftJoin(tenants, eq(accessRequests.tenantId, tenants.id))
    .where(status ? eq(accessRequests.status, status) : undefined)
    .orderBy(desc(accessRequests.createdAt))
    .limit(200);
}

export async function countNewAccessRequests(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(accessRequests)
    .where(eq(accessRequests.status, "new"));
  return row?.n ?? 0;
}

export async function markAccessRequest(
  id: string,
  status: "approved" | "declined",
  adminId: string,
  tenantId?: string
): Promise<void> {
  const [row] = await db.select({ id: accessRequests.id }).from(accessRequests).where(eq(accessRequests.id, id));
  if (!row) throw new ServiceError("Request not found.", 404);
  await db
    .update(accessRequests)
    .set({ status, reviewedBy: adminId, reviewedAt: new Date(), tenantId: tenantId ?? null })
    .where(eq(accessRequests.id, id));
}
