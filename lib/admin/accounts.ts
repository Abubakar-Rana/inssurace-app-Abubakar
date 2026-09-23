/**
 * Agency and user provisioning — used by the Nestnic console and, where Nestnic
 * allows it, by an agency's own admins.
 *
 * RULES
 *  - Accounts are only ever created here, never at sign-in. Membership of an
 *    agency is an explicit decision somebody made and the audit log recorded.
 *  - New accounts get a temporary password, returned ONCE to the caller and
 *    never stored in readable form. The user must replace it at first sign-in.
 *  - An email belongs to one agency only; sign-in is by email alone.
 *  - An agency can never be left without an active admin, and nobody can
 *    disable or demote themselves — both are how people lock themselves out.
 *  - Every change is audited inside the same transaction, against the agency
 *    it affects, naming whether Nestnic or an agency admin did it.
 */

import { randomUUID } from "node:crypto";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db, withTenant, type TenantDb } from "@/lib/db/client";
import {
  producers,
  tenantKeys,
  tenantMailSettings,
  tenantNowcertsSettings,
  tenants,
  users,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { createTenantKey } from "@/lib/crypto/envelope";
import { hashPassword, temporaryPassword } from "@/lib/auth/password";
import { ServiceError } from "@/lib/certificate/service";

export type Role = "admin" | "reviewer" | "readonly";
const ROLES: Role[] = ["admin", "reviewer", "readonly"];

/** Who is acting. Nestnic staff are not `users`, so they are recorded by id + kind. */
export interface Actor {
  kind: "platform" | "agency";
  id: string;
  email: string;
}

function auditActor(actor: Actor) {
  return { actorUserId: actor.id, by: actor.kind === "platform" ? `nestnic:${actor.email}` : actor.email };
}

// ---------------------------------------------------------------- validation

export function cleanEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
    throw new ServiceError("Enter a valid email address.");
  }
  return email;
}

export function cleanName(value: unknown, what = "Name"): string {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 120) throw new ServiceError(`${what} is required (max 120 characters).`);
  return name;
}

function cleanRole(value: unknown): Role {
  if (!ROLES.includes(value as Role)) throw new ServiceError("Role must be admin, reviewer or readonly.");
  return value as Role;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function assertEmailFree(email: string, exceptUserId?: string): Promise<void> {
  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(exceptUserId ? and(eq(users.email, email), ne(users.id, exceptUserId)) : eq(users.email, email));
  if (taken) throw new ServiceError("That email already has a CertFlow account.", 409);
}

// ---------------------------------------------------------------- agencies

export interface CreateAgencyInput {
  name: unknown;
  slug?: unknown;
  allowUserManagement?: unknown;
  admin: { name: unknown; email: unknown };
}

/**
 * Create an agency, its encryption key, a default PRODUCER block and its first
 * admin, all in one transaction — a half-created agency (say, one without a
 * key) could never store credentials and would fail in confusing ways later.
 */
export async function createAgency(actor: Actor, input: CreateAgencyInput) {
  const name = cleanName(input.name, "Agency name");
  const slug = slugify(typeof input.slug === "string" && input.slug.trim() ? input.slug : name);
  if (!slug) throw new ServiceError("Agency name must contain letters or numbers.");
  const adminName = cleanName(input.admin?.name, "Admin name");
  const adminEmail = cleanEmail(input.admin?.email);

  const [clash] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug));
  if (clash) throw new ServiceError(`An agency with the short name "${slug}" already exists.`, 409);
  await assertEmailFree(adminEmail);

  const tenantId = randomUUID();
  const tempPassword = temporaryPassword();
  const passwordHash = await hashPassword(tempPassword);

  // withTenant pins RLS to the id we are about to create, which is what lets
  // the tenants row itself pass its own policy (see db/seed.ts).
  const adminId = await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name,
      slug,
      allowUserManagement: input.allowUserManagement === true,
    });
    await tx.insert(tenantKeys).values({ tenantId, wrappedDek: createTenantKey().wrappedDek });
    // A placeholder the agency admin completes in Settings. Without a default
    // producer no certificate can be drafted at all.
    await tx.insert(producers).values({
      tenantId,
      name,
      addressLines: "",
      contactName: adminName,
      email: adminEmail,
      isDefault: true,
    });
    const [admin] = await tx
      .insert(users)
      .values({ tenantId, email: adminEmail, name: adminName, role: "admin", passwordHash, mustChangePassword: true })
      .returning({ id: users.id });

    const { by } = auditActor(actor);
    await audit(tx, {
      tenantId,
      actorUserId: actor.id,
      action: "tenant.created",
      subjectType: "tenant",
      subjectId: tenantId,
      after: { name, slug, by, firstAdmin: adminEmail, allowUserManagement: input.allowUserManagement === true },
    });
    return admin.id;
  });

  return { tenantId, slug, adminId, adminEmail, tempPassword };
}

export async function listAgencies() {
  // Unscoped on purpose: this is the Nestnic console's cross-agency view. It
  // reads account metadata and switches only — never requests or certificates.
  return db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      allowUserManagement: tenants.allowUserManagement,
      autoSend: tenants.autoSend,
      dataSource: tenants.dataSource,
      createdAt: tenants.createdAt,
      userCount: sql<number>`(select count(*)::int from ${users} u where u.tenant_id = ${tenants.id})`,
      mailConfigured: sql<boolean>`exists (select 1 from ${tenantMailSettings} m where m.tenant_id = ${tenants.id})`,
      nowcertsConfigured: sql<boolean>`exists (select 1 from ${tenantNowcertsSettings} n where n.tenant_id = ${tenants.id})`,
    })
    .from(tenants)
    .orderBy(asc(tenants.name));
}

export async function getAgency(tenantId: string) {
  const [tenant] = (await listAgencies()).filter((t) => t.id === tenantId);
  if (!tenant) throw new ServiceError("Agency not found.", 404);
  return { tenant, users: await listUsers(tenantId) };
}

/** Nestnic-only switches. An agency cannot change these about itself. */
export async function updateAgency(
  actor: Actor,
  tenantId: string,
  patch: { name?: unknown; status?: unknown; allowUserManagement?: unknown }
) {
  const set: Partial<typeof tenants.$inferInsert> = {};
  if (patch.name !== undefined) set.name = cleanName(patch.name, "Agency name");
  if (patch.status !== undefined) {
    if (patch.status !== "active" && patch.status !== "suspended") {
      throw new ServiceError("Status must be active or suspended.");
    }
    set.status = patch.status;
  }
  if (patch.allowUserManagement !== undefined) set.allowUserManagement = patch.allowUserManagement === true;
  if (!Object.keys(set).length) throw new ServiceError("Nothing to change.");

  return withTenant(tenantId, async (tx) => {
    const [before] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!before) throw new ServiceError("Agency not found.", 404);
    await tx.update(tenants).set(set).where(eq(tenants.id, tenantId));
    await audit(tx, {
      tenantId,
      actorUserId: actor.id,
      action: "tenant.updated",
      subjectType: "tenant",
      subjectId: tenantId,
      before: { name: before.name, status: before.status, allowUserManagement: before.allowUserManagement },
      after: { ...set, by: auditActor(actor).by },
    });
    return { ok: true };
  });
}

// ---------------------------------------------------------------- users

export async function listUsers(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        status: users.status,
        hasPassword: sql<boolean>`${users.passwordHash} is not null`,
        mustChangePassword: users.mustChangePassword,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(asc(users.name))
  );
}

export async function createUser(
  actor: Actor,
  tenantId: string,
  input: { name: unknown; email: unknown; role: unknown }
) {
  const name = cleanName(input.name);
  const email = cleanEmail(input.email);
  const role = cleanRole(input.role ?? "reviewer");
  await assertEmailFree(email);

  const tempPassword = temporaryPassword();
  const passwordHash = await hashPassword(tempPassword);

  const id = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({ tenantId, email, name, role, passwordHash, mustChangePassword: true })
      .returning({ id: users.id });
    await audit(tx, {
      tenantId,
      actorUserId: actor.id,
      action: "user.created",
      subjectType: "user",
      subjectId: row.id,
      after: { email, role, by: auditActor(actor).by },
    });
    return row.id;
  });
  return { id, email, tempPassword };
}

async function activeAdminCount(tx: TenantDb, exceptUserId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "active"), ne(users.id, exceptUserId)));
  return row?.n ?? 0;
}

export async function updateUser(
  actor: Actor,
  tenantId: string,
  userId: string,
  patch: { name?: unknown; role?: unknown; status?: unknown }
) {
  return withTenant(tenantId, async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId));
    if (!user) throw new ServiceError("User not found.", 404);

    const set: Partial<typeof users.$inferInsert> = {};
    if (patch.name !== undefined) set.name = cleanName(patch.name);
    if (patch.role !== undefined) set.role = cleanRole(patch.role);
    if (patch.status !== undefined) {
      if (patch.status !== "active" && patch.status !== "disabled") {
        throw new ServiceError("Status must be active or disabled.");
      }
      set.status = patch.status;
    }
    if (!Object.keys(set).length) throw new ServiceError("Nothing to change.");

    const losesAdmin =
      user.role === "admin" && user.status === "active" && ((set.role && set.role !== "admin") || set.status === "disabled");
    if (losesAdmin && actor.kind === "agency" && actor.id === userId) {
      throw new ServiceError("You cannot remove your own admin access or disable yourself.", 409);
    }
    if (losesAdmin && (await activeAdminCount(tx, userId)) === 0) {
      throw new ServiceError("An agency must keep at least one active admin.", 409);
    }

    await tx.update(users).set(set).where(eq(users.id, userId));
    await audit(tx, {
      tenantId,
      actorUserId: actor.id,
      action: "user.updated",
      subjectType: "user",
      subjectId: userId,
      before: { name: user.name, role: user.role, status: user.status },
      after: { ...set, by: auditActor(actor).by },
    });
    return { ok: true };
  });
}

/** Issue a new temporary password. Also clears a lockout — that is usually why it was asked for. */
export async function resetPassword(actor: Actor, tenantId: string, userId: string) {
  const tempPassword = temporaryPassword();
  const passwordHash = await hashPassword(tempPassword);
  await withTenant(tenantId, async (tx) => {
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!user) throw new ServiceError("User not found.", 404);
    await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: true, failedLogins: 0, lockedUntil: null })
      .where(eq(users.id, userId));
    await audit(tx, {
      tenantId,
      actorUserId: actor.id,
      action: "user.password_reset",
      subjectType: "user",
      subjectId: userId,
      after: { by: auditActor(actor).by },
    });
  });
  return { tempPassword };
}
