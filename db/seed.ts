/**
 * Seeds one agency with the exact data from COI_TRUCK_SOLUTION.PDF.
 *
 * This is deliberately a faithful reproduction of a real issued certificate,
 * because the near-term goal is to show ACORD that CertFlow fills their form
 * correctly from a database. Running the assembler against this seed should
 * reproduce that document field for field — including the two free coverage
 * rows (Motor Truck Cargo, Physical Damage) and the six-vehicle fleet that
 * overflows onto an ACORD 101.
 *
 *   npm run db:seed        # idempotent: clears and re-seeds this one tenant
 */

import "@/lib/env";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, withTenant } from "@/lib/db/client";
import { createTenantKey } from "@/lib/crypto/envelope";
import { interpretRequest } from "@/lib/matching/interpret";
import { generateDraft } from "@/lib/certificate/service";
import {
  clientAliases,
  clients,
  coiRequests,
  insurers,
  policies,
  producers,
  tenantKeys,
  tenants,
  users,
  vehicles,
} from "./schema";

const TENANT_SLUG = "whittington";

/**
 * The insured's vehicle schedule, in the order the sample certificate lists it:
 * the first appears in DESCRIPTION OF OPERATIONS on page 1, the rest on the
 * ACORD 101. Array position becomes `vehicles.sortOrder`.
 */
const FLEET = [
  { year: 2019, make: "HINO", model: "Conventional Type Truck", vin: "5PVNE8JV5K4S56954", statedValue: "18250" },
  { year: 2020, make: "HINO", model: "258/268", vin: "5PVNJ8JV3L4S77508", statedValue: "32000" },
  { year: 2016, make: "HINO", model: "258/268", vin: "5PVNJ8JV3G4S61847", statedValue: "25000" },
  { year: 2015, make: "HINO", model: "258/268", vin: "5PVNJ8JV7F4S59601", statedValue: "25000" },
  { year: 2014, make: "HINO", model: "258/268", vin: "5PVNJ8JTXE4S55345", statedValue: "20000" },
  { year: 2016, make: "HINO", model: "Conventional Type Truck", vin: "5PVNJ8JV8G4S60838", statedValue: "22000" },
];

/**
 * Inbound COI requests, written the way real ones arrive.
 *
 * The insured is Smart Way Solutions Inc. Note that in every message the SENDER
 * is a different company — that is the normal shape of a COI request, and the
 * reason the extractor must never take the company name from the signature.
 */
const INBOX = [
  {
    // The easy case: insured named plainly in the subject.
    // `.example` is IANA-reserved and can never route. Every seeded sender
    // uses it deliberately: once delivery is wired, pressing Send on demo data
    // must not be able to email a real company.
    fromAddr: "certs@datsolutions.example",
    fromName: "DAT Solutions Compliance",
    subject: "COI request — Smart Way Solutions Inc",
    receivedAt: "2026-07-16T14:12:00Z",
    body: [
      "Hi,",
      "",
      "We need a current certificate of insurance on file before the next load.",
      "Please send it to this address.",
      "",
      "Thanks,",
      "Compliance Team",
      "DAT Solutions LLC",
    ].join("\n"),
  },
  {
    // Insured named only in the body, misspelled, with the sender's own
    // company all over the signature.
    fromAddr: "dispatch@midwestfreight.example",
    fromName: "Midwest Freight Brokers",
    subject: "Insurance paperwork",
    receivedAt: "2026-07-16T15:40:00Z",
    body: [
      "Good afternoon,",
      "",
      "Could you send over a certificate of insurance for Smartway Solutions?",
      "We are setting them up as a carrier and need it for the file.",
      "",
      "Regards,",
      "Dana Whitfield",
      "Midwest Freight Brokers Inc",
    ].join("\n"),
  },
  {
    // Explicit label, plus a wrong-suffix spelling.
    fromAddr: "ap@northstarlogistics.example",
    fromName: "Northstar Logistics",
    subject: "Carrier packet - insurance",
    receivedAt: "2026-07-17T09:05:00Z",
    body: [
      "Please complete the attached carrier packet.",
      "",
      "Insured: Smart Way Solutions, LLC",
      "Holder: Northstar Logistics",
      "",
      "Thank you",
    ].join("\n"),
  },
  {
    // A company we do not insure -> must refuse, not guess.
    fromAddr: "compliance@bluelinecarriers.example",
    fromName: "Blue Line Carriers",
    subject: "COI for Roadrunner Freight Systems",
    receivedAt: "2026-07-17T11:22:00Z",
    body: "We need a certificate of insurance for Roadrunner Freight Systems.\n\nThanks",
  },
  {
    // Names nobody — the sender assumes we know. Must go to a human.
    fromAddr: "ops@harborlinkshipping.example",
    fromName: "Harborlink Shipping",
    subject: "Certificate please",
    receivedAt: "2026-07-17T13:47:00Z",
    body: [
      "Hi there,",
      "",
      "Can you send the usual certificate over? Same as last time.",
      "",
      "Cheers",
    ].join("\n"),
  },
];

async function main() {
  // Reset this tenant only — never truncate, other agencies may share the DB.
  const existing = await db.select().from(tenants).where(eq(tenants.slug, TENANT_SLUG));
  for (const t of existing) {
    await db.delete(tenants).where(eq(tenants.id, t.id)); // cascades
  }

  const tenantId = randomUUID();

  // `tenants` is protected by its own RLS policy, so the very first insert has
  // to declare which tenant it is creating. Generating the id client-side and
  // setting the session variable first resolves that chicken-and-egg.
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('certflow.tenant_id', ${tenantId}, true)`);
    await tx.insert(tenants).values({
      id: tenantId,
      name: "Whittington Agency, LLC",
      slug: TENANT_SLUG,
      sendingDomain: "whittingtonagency.com",
      // The sample was issued on ACORD 25 (2014/01); we render the current
      // 2025/12 edition, which is what public/acord25-blank.pdf is and what a
      // licence application should target. Field geometry is unchanged between
      // them — data transcribed from the 2014/01 sample lands correctly on the
      // 2025/12 form. This column exists so a tenant can be pinned to an
      // edition once more than one blank is checked in.
      acordEdition: "2025/12",
    });

    // Security L1: mint this agency's data key immediately. The plaintext DEK
    // is never persisted — only the form wrapped by the master KEK.
    const { wrappedDek } = createTenantKey();
    await tx.insert(tenantKeys).values({ tenantId, wrappedDek });
  });

  // Insurers are national reference data, shared across tenants and not
  // tenant-scoped, so this insert lives outside withTenant.
  const [nationalGeneral] = await db
    .insert(insurers)
    .values({ name: "National General Insurance Company", naic: "23728" })
    .onConflictDoUpdate({ target: insurers.naic, set: { name: "National General Insurance Company" } })
    .returning();

  await withTenant(tenantId, async (tx) => {
    await tx.insert(users).values({
      tenantId,
      email: "certificates@whittingtonagency.com",
      name: "Certificate Department",
      role: "admin",
      mfaEnabled: true,
    });

    await tx.insert(producers).values({
      tenantId,
      name: "Whittington Agency, LLC",
      addressLines: "2514 Walker Ave\nGreensboro, NC 27403",
      contactName: "Certificate Department",
      phone: "336-390-1319",
      fax: "336-441-5555",
      email: "certificates@whittingtonagency.com",
      isDefault: true,
    });

    const [client] = await tx
      .insert(clients)
      .values({
        tenantId,
        clientNumber: "SWS-1001",
        legalName: "Smart Way Solutions Inc",
        addressLines: "7059 Tallent Ct\nSherrills Ford, NC 28673-9763",
        // Federal identifiers. Unique to one carrier, which is what makes them
        // the reliable way to settle a request that names two companies
        // equally well — see lib/matching/identifier.ts.
        dotNumber: "3121884",
        mcNumber: "1084463",
      })
      .returning();

    /**
     * A SECOND company whose name is nearly identical.
     *
     * Seeded on purpose. With one client on the books the resolver looks
     * infallible, because there is nothing to confuse it with. Real agencies
     * carry hundreds of names, and pairs like these — the same trading name
     * under a different entity — are common and are exactly the case where
     * guessing produces a certificate stating another company's coverage.
     *
     * Everything about the ambiguous path is only demonstrable because this
     * row exists.
     */
    const [sibling] = await tx
      .insert(clients)
      .values({
        tenantId,
        clientNumber: "SWS-1002",
        legalName: "Smart Way Solutions LLC",
        addressLines: "412 Industrial Park Dr\nHickory, NC 28602-1140",
        dotNumber: "2988014",
        mcNumber: "1043790",
      })
      .returning();

    // Real inbound email rarely spells the name the way the policy does.
    // Deliberately NOT including "Smartway Solutions" against either row: that
    // spelling belongs to both companies, and giving it to one would resolve
    // an ambiguous request by accident of the seed.
    await tx.insert(clientAliases).values([
      { tenantId, clientId: client.id, alias: "Smart Way Solutions Incorporated" },
      { tenantId, clientId: sibling.id, alias: "Smart Way Solutions Limited" },
    ]);

    const shared = {
      tenantId,
      clientId: client.id,
      insurerId: nationalGeneral.id,
      policyNumber: "2026256248",
      effDate: "2025-12-26",
      expDate: "2026-12-26",
    };

    await tx.insert(policies).values([
      {
        ...shared,
        kind: "auto",
        // "X" against SCHEDULED AUTOS on the sample document.
        flags: { scope: "scheduled" },
        limits: { combinedSingle: "1000000" },
        // Verbatim from the sample's DESCRIPTION OF OPERATIONS. The agency
        // writes this sentence; CertFlow prints it and does not generate it.
        operationsNote:
          "This Policy '2026256248' has Other Coverage 'Expanded Accident Towing' With Limit " +
          "'$40,000'. Carrier: 'National General Insurance Company', Effective Date: " +
          "'12/26/2025', Expiration Date: '12/26/2026'.",
      },
      {
        ...shared,
        kind: "cargo",
        label: "Motor Truck Cargo",
        limitText: "Limit: $100,000, Deductible: $2,500",
      },
      {
        ...shared,
        kind: "physDamage",
        label: "Physical Damage",
        limitText: "Deductibles - Comp: $2,500, Coll: $2,500",
      },
    ]);

    await tx.insert(vehicles).values(
      FLEET.map((v, i) => ({
        ...v,
        tenantId,
        clientId: client.id,
        sortOrder: i,
        deductibleComp: "2500",
        deductibleColl: "2500",
      }))
    );

    /**
     * Coverage for the sibling company.
     *
     * Deliberately smaller and different — a different carrier, different
     * limits, a two-truck fleet. If both companies carried identical policies
     * the clarification exchange would be theatre: it would not matter which
     * one the requester picked, and a wrong answer would be invisible.
     *
     * It also means either company can actually produce a certificate. Without
     * this the sibling exists only to be refused, and a request that legitimately
     * resolves to it would hit "no active policies" instead of a document.
     */
    await tx.insert(policies).values([
      {
        tenantId,
        clientId: sibling.id,
        insurerId: nationalGeneral.id,
        policyNumber: "2026771904",
        effDate: "2026-03-01",
        expDate: "2027-03-01",
        kind: "auto",
        flags: { scope: "scheduled" },
        limits: { combinedSingle: "750000" },
      },
      {
        tenantId,
        clientId: sibling.id,
        insurerId: nationalGeneral.id,
        policyNumber: "2026771905",
        effDate: "2026-03-01",
        expDate: "2027-03-01",
        kind: "cargo",
        label: "Motor Truck Cargo",
        limits: {},
        flags: {},
        limitText: "Limit: $50,000, Deductible: $1,000",
      },
    ]);

    await tx.insert(vehicles).values([
      {
        tenantId,
        clientId: sibling.id,
        year: 2022,
        make: "KENWORTH",
        model: "T680",
        vin: "1XKYDP9X4NJ441201",
        statedValue: "128000",
        deductibleComp: "1000",
        deductibleColl: "1000",
        sortOrder: 0,
      },
      {
        tenantId,
        clientId: sibling.id,
        year: 2020,
        make: "UTILITY",
        model: "3000R Reefer",
        vin: "1UYVS2538L2914773",
        statedValue: "64500",
        deductibleComp: "1000",
        deductibleColl: "1000",
        sortOrder: 1,
      },
    ]);

    // Inbound requests, deliberately unmatched.
    //
    // `clientId` is null and status is "new" on purpose: identifying the
    // insured is the system's job, not the seed's. Running interpretation over
    // these exercises the real path — email text -> candidate name -> client
    // record -> certificate. Several are written to be refused; see
    // scripts/verify-interpretation.ts for what each one is testing.
    await tx.insert(coiRequests).values(
      INBOX.map((mail, i) => ({
        tenantId,
        gmailMessageId: `seed-${i + 1}`,
        gmailThreadId: `seed-thread-${i + 1}`,
        fromAddr: mail.fromAddr,
        fromName: mail.fromName,
        subject: mail.subject,
        bodyText: mail.body,
        receivedAt: new Date(mail.receivedAt),
        authResults: { spf: "pass", dkim: "pass", dmarc: "pass" },
        status: "new" as const,
        // No holderId. The certificate holder is whoever wrote in, and that is
        // read from each email's signature when the draft is assembled — see
        // lib/matching/holder.ts. Seeding one here would print the same company
        // on every certificate whoever asked for it.
      }))
    );
  });

  // Interpret what we just seeded, so the inbox opens in the state it would be
  // in after a Gmail poll: some matched, some waiting on a human. Seeding them
  // pre-matched would hide the step; leaving them raw would make every row look
  // like a failure until someone clicked something.
  const seededRequests = await withTenant(tenantId, (tx) =>
    tx.select({ id: coiRequests.id }).from(coiRequests)
  );
  let matched = 0;
  let drafted = 0;
  for (const r of seededRequests) {
    const result = await interpretRequest(tenantId, r.id);
    if (result.decision !== "matched") continue;
    matched++;
    // Drafting is automatic in the real pipeline; seeding without it would
    // leave the inbox in a state the running system never actually produces.
    try {
      await generateDraft({ tenantId, actorUserId: null }, r.id);
      drafted++;
    } catch (err) {
      console.warn(`  could not draft for ${r.id}: ${(err as Error).message}`);
    }
  }

  console.log(`seeded tenant ${TENANT_SLUG} (${tenantId})`);
  console.log(
    `  ${seededRequests.length} requests: ${matched} matched, ${seededRequests.length - matched} need a human`
  );
  console.log(`  ${drafted} certificate(s) drafted automatically, awaiting review`);
  // Counted, not asserted. A hardcoded summary drifts the moment the seed
  // changes and then quietly misreports what is in the database.
  const totals = await withTenant(tenantId, async (tx) => ({
    clients: (await tx.select({ id: clients.id }).from(clients)).length,
    policies: (await tx.select({ id: policies.id }).from(policies)).length,
    vehicles: (await tx.select({ id: vehicles.id }).from(vehicles)).length,
  }));
  console.log(
    `  ${totals.clients} clients (deliberately near-identical), ${totals.policies} policies, ${totals.vehicles} vehicles`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
