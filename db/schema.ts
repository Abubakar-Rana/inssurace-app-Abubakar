/**
 * CertFlow database schema — multi-tenant, security-first.
 *
 * TWO RULES THAT ARE EXPENSIVE TO ADD LATER, SO THEY ARE HERE ON DAY ONE:
 *
 *  1. Every tenant-owned table carries `tenantId`. Row-level security policies
 *     in db/rls.sql key off it, so one agency physically cannot read another's
 *     rows even if application code has a bug. (Security L3)
 *
 *  2. Encrypted columns are suffixed `Enc` and hold base64 AES-256-GCM
 *     ciphertext produced by lib/crypto/envelope.ts, wrapped with a per-tenant
 *     data key. Deleting that key crypto-shreds the tenant. (Security L1 / L6)
 *
 * WHAT IS DELIBERATELY *NOT* ENCRYPTED, AND WHY:
 *   clients.legalName stays plaintext because entity resolution fuzzy-matches
 *   it with pg_trgm. Ciphertext cannot be searched — encrypting this column
 *   would break the core feature of the product. It is protected by database
 *   and disk encryption instead. Exact-match lookups on genuinely secret
 *   identifiers use a blind index (`feinBidx`) rather than plaintext.
 */

import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------- enums

export const userRole = pgEnum("user_role", ["admin", "reviewer", "readonly"]);

/** ACORD 25 coverage sections. `cargo`/`physDamage`/`other` land in the free
 *  rows beneath Workers Comp — trucking certificates routinely use 2-3 of them. */
export const policyKind = pgEnum("policy_kind", [
  "cgl",
  "auto",
  "umbrella",
  "workersComp",
  "cargo",
  "physDamage",
  "other",
]);

export const requestStatus = pgEnum("request_status", [
  "new",
  "interpreting",
  "needsMatch",
  /** Asked the requester which company they meant; waiting for their reply. */
  "awaitingRequester",
  "ready",
  "approved",
  "sent",
  "rejected",
]);

export const certStatus = pgEnum("cert_status", ["draft", "issued", "voided"]);

// ---------------------------------------------------------------- tenancy

/** One row per insurance agency that buys CertFlow. */
export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  sendingDomain: text("sending_domain"),
  acordEdition: text("acord_edition").notNull().default("2014/01"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Envelope encryption (Security L1).
 *
 * `wrappedDek` is this tenant's data key, itself encrypted with the master KEK
 * from the environment. Storing it here is safe: without the KEK it is noise.
 * This is what makes per-tenant keys workable — the alternative (one env var
 * per agency) cannot scale past a handful of customers.
 *
 * Setting `revokedAt` and dropping the row crypto-shreds the tenant: every
 * ciphertext they own becomes permanently unreadable, satisfying "delete all my
 * data" without touching the immutable audit log. (Security L6)
 */
export const tenantKeys = pgTable("tenant_keys", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  wrappedDek: text("wrapped_dek").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: userRole("role").notNull().default("reviewer"),
    // Identity lives at the IdP (Google Workspace / Entra). No password column
    // exists here by design — nothing to phish, leak, or reset. (Security L3)
    externalSubject: text("external_subject"),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    emailUq: uniqueIndex("users_tenant_email_uq").on(t.tenantId, t.email),
  })
);

// ---------------------------------------------------------------- reference

/** National reference data — NAIC codes are federal, not per-agency, so this
 *  table is intentionally NOT tenant-scoped and carries no RLS policy. */
export const insurers = pgTable(
  "insurers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    naic: text("naic"),
  },
  (t) => ({
    naicUq: uniqueIndex("insurers_naic_uq").on(t.naic),
  })
);

/** The agency's own details — the PRODUCER box on the ACORD 25. An agency may
 *  have several branch offices, each issuing under its own contact block. */
export const producers = pgTable("producers", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  addressLines: text("address_lines").notNull(),
  contactName: text("contact_name"),
  phone: text("phone"),
  fax: text("fax"),
  email: text("email"),
  isDefault: boolean("is_default").notNull().default(false),
});

// ---------------------------------------------------------------- insureds

/** The trucking company being insured — the INSURED box. */
export const clients = pgTable(
  "clients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    clientNumber: text("client_number"),
    // Plaintext on purpose — see the header note on fuzzy matching.
    legalName: text("legal_name").notNull(),
    dba: text("dba"),
    addressLines: text("address_lines").notNull(),
    dotNumber: text("dot_number"),
    mcNumber: text("mc_number"),
    // FEIN is genuinely secret and only ever looked up by exact value, so it is
    // encrypted and searched via a deterministic HMAC blind index.
    feinEnc: text("fein_enc"),
    feinBidx: text("fein_bidx"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantIdx: index("clients_tenant_idx").on(t.tenantId),
    dotIdx: index("clients_dot_idx").on(t.tenantId, t.dotNumber),
    feinIdx: index("clients_fein_bidx").on(t.tenantId, t.feinBidx),
  })
);

/** Alternate spellings seen in the wild ("Smartway Solutions", "Smart Way
 *  Solutions Inc"). Feeds entity resolution so a near-miss still matches. */
export const clientAliases = pgTable(
  "client_aliases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
  },
  (t) => ({ aliasIdx: index("client_aliases_idx").on(t.tenantId, t.alias) })
);

/**
 * A policy = one row on the ACORD 25 coverage grid.
 *
 * `limits` is jsonb because each coverage kind has a different set (CGL has six
 * named limits, Auto has four, Cargo is free text). A column per limit would
 * mean ~20 mostly-null columns and a migration every time ACORD revises a form.
 * `flags` holds the checkbox state (scope, form, aggregatePer, perStatute).
 */
export const policies = pgTable(
  "policies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    insurerId: uuid("insurer_id")
      .notNull()
      .references(() => insurers.id),
    kind: policyKind("kind").notNull(),
    /** Free-text row label for cargo/physDamage/other, e.g. "Motor Truck Cargo". */
    label: text("label"),
    policyNumber: text("policy_number").notNull(),
    effDate: date("eff_date").notNull(),
    expDate: date("exp_date").notNull(),
    addlInsd: boolean("addl_insd").notNull().default(false),
    subrWvd: boolean("subr_wvd").notNull().default(false),
    limits: jsonb("limits").$type<Record<string, string>>().notNull().default({}),
    flags: jsonb("flags").$type<Record<string, string | boolean>>().notNull().default({}),
    /** Free-text limit cell used by the cargo / physical-damage rows. */
    limitText: text("limit_text"),
    /**
     * Free text for DESCRIPTION OF OPERATIONS, printed above the vehicle list.
     *
     * Endorsements and clarifications that have no box on the ACORD 25 land
     * here — "Certificate holder is additional insured where required by
     * written contract", or the sample's expanded-towing note. Stored per
     * policy because that is what the sentence is about, and printed verbatim:
     * the agency owns the wording, so nothing here is generated.
     */
    operationsNote: text("operations_note"),
    status: text("status").notNull().default("active"),
  },
  (t) => ({
    clientIdx: index("policies_client_idx").on(t.tenantId, t.clientId),
  })
);

/** Fleet vehicles. These are what overflow page 1 and force an ACORD 101. */
export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    year: integer("year"),
    make: text("make"),
    model: text("model"),
    vin: text("vin").notNull(),
    statedValue: text("stated_value"),
    deductibleComp: text("deductible_comp"),
    deductibleColl: text("deductible_coll"),
    /**
     * Position on the insured's vehicle schedule.
     *
     * Fleets are listed in the order the agency schedules them, not by year or
     * VIN, and a certificate that reorders them reads as a different document
     * to anyone comparing it against the policy. Sorting on a stored column
     * keeps output reproducible — required for the PDF hash taken at approval —
     * while still matching the source of record. Ties break on VIN.
     */
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => ({ clientIdx: index("vehicles_client_idx").on(t.tenantId, t.clientId) })
);

/** Reusable certificate holders — brokers and load boards request constantly,
 *  so the same holder (DAT, Highway) recurs across many certificates. */
export const certificateHolders = pgTable(
  "certificate_holders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    addressLines: text("address_lines").notNull(),
    email: text("email"),
  },
  (t) => ({ tenantIdx: index("holders_tenant_idx").on(t.tenantId) })
);

// ---------------------------------------------------------------- pipeline

/**
 * An inbound COI request.
 *
 * The email body is NOT stored here — only an object-store key and a hash. That
 * keeps bodies purgeable on the 30-day clock (Security L6) without rewriting
 * this row, and keeps PII out of anything that joins against it.
 */
export const coiRequests = pgTable(
  "coi_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    gmailMessageId: text("gmail_message_id").notNull(),
    gmailThreadId: text("gmail_thread_id"),
    fromAddr: text("from_addr").notNull(),
    fromName: text("from_name"),
    subject: text("subject"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    /** Result of SPF/DKIM/DMARC checks, recorded at intake. */
    authResults: jsonb("auth_results").$type<Record<string, string>>(),
    bodyObjectKey: text("body_object_key"),
    bodySha256: text("body_sha256"),
    /**
     * The email body, pending object storage.
     *
     * The target design keeps bodies out of Postgres — `bodyObjectKey` points
     * at encrypted object storage, and `purgeAfter` deletes them on the L6
     * schedule. That store does not exist yet, so the text lives here in the
     * meantime under the same `purgeAfter` / `legalHold` rules.
     *
     * Interpretation reads this; nothing else should. When object storage
     * lands, move the text and drop this column.
     */
    bodyText: text("body_text"),
    status: requestStatus("status").notNull().default("new"),
    clientId: uuid("client_id").references(() => clients.id),
    holderId: uuid("holder_id").references(() => certificateHolders.id),
    matchConfidence: text("match_confidence"),
    /**
     * When the system asked the requester which company they meant.
     *
     * Set once and never cleared. It is what stops a request being asked twice:
     * a second question to somebody who has not answered the first reads as a
     * malfunction, and two unanswered questions in a thread are worse than one.
     */
    clarificationSentAt: timestamp("clarification_sent_at", { withTimezone: true }),
    /**
     * When a reviewer first opened this request.
     *
     * Null means nobody has looked at it yet, which is what the unread count on
     * the dashboard is. Stored rather than kept in the browser so the count is
     * the same on every device and survives a sign-out — "have we dealt with
     * this?" is a property of the agency, not of one laptop.
     */
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    viewedBy: uuid("viewed_by").references(() => users.id),
    /** Purge jobs skip rows past this date unless legalHold is set. */
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    legalHold: boolean("legal_hold").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    msgUq: uniqueIndex("coi_requests_msg_uq").on(t.tenantId, t.gmailMessageId),
    statusIdx: index("coi_requests_status_idx").on(t.tenantId, t.status),
  })
);

/**
 * Raw LLM output, retained for audit and replay.
 *
 * This is a derivative copy of the email and therefore inherits the SAME 30-day
 * purge clock. Keeping interpretations after purging bodies would quietly
 * recreate the PII store that data minimisation exists to eliminate.
 */
export const interpretations = pgTable("interpretations", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  requestId: uuid("request_id")
    .notNull()
    .references(() => coiRequests.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  outputEnc: text("output_enc").notNull(),
  confidence: text("confidence"),
  purgeAfter: timestamp("purge_after", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * An issued certificate.
 *
 * `snapshot` is the complete certificate object frozen at approval. Issued
 * certificates are NEVER re-derived from live policy data — policies renew and
 * limits change, and a reprint must show what was actually certified. Changes
 * create a new `revision`, never a mutation. `pdfSha256` proves the delivered
 * bytes match what was approved.
 */
export const certificates = pgTable(
  "certificates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").references(() => coiRequests.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    certificateNumber: text("certificate_number").notNull(),
    revision: integer("revision").notNull().default(0),
    acordEdition: text("acord_edition").notNull(),
    snapshot: jsonb("snapshot").$type<unknown>().notNull(),
    pdfObjectKey: text("pdf_object_key"),
    pdfSha256: text("pdf_sha256"),
    status: certStatus("status").notNull().default("draft"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    numUq: uniqueIndex("certificates_num_rev_uq").on(t.tenantId, t.certificateNumber, t.revision),
  })
);

export const deliveries = pgTable("deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  certificateId: uuid("certificate_id")
    .notNull()
    .references(() => certificates.id, { onDelete: "cascade" }),
  method: text("method").notNull(),
  toAddr: text("to_addr").notNull(),
  sentBy: uuid("sent_by").references(() => users.id),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  providerMessageId: text("provider_message_id"),
});

/**
 * Immutable audit log (Security L4).
 *
 * Append-only: db/rls.sql revokes UPDATE and DELETE from the application role,
 * so immutability is enforced by the database rather than by convention.
 *
 * `hash` chains each entry to its predecessor, making tampering *detectable*
 * and not merely forbidden — altering any entry breaks every hash after it.
 *
 * Stores references and hashes, never content. Embedding email bodies here
 * would make the 30-day purge impossible and turn the audit log into the very
 * PII store L6 exists to prevent.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id"),
    before: jsonb("before").$type<unknown>(),
    after: jsonb("after").$type<unknown>(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull(),
  },
  (t) => ({
    tenantIdx: index("audit_tenant_at_idx").on(t.tenantId, t.at),
  })
);
