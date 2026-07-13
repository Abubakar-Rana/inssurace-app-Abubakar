// Simulated data layer.
// In production, `email.*` fields would be parsed from an inbound email thread,
// and `ams.*` fields would be fetched live from the AMS360 / AgencyOne API.
// Here everything is hard-coded so the prototype flow is fully self-contained.

export const AGENCY_PRODUCER = {
  name: "New Hope Insurance Agency",
  address: "2664 S New Hope Rd\nGastonia, NC 28056",
  contactName: "Axel Moreno",
  phone: "704-824-3130",
  fax: "704-943-0590",
  email: "commercial@newhopeins.com",
};

const emptyLimits = {
  eachOccurrence: "",
  damageToRented: "",
  medExp: "",
  personalAdvInjury: "",
  generalAggregate: "",
  productsCompOp: "",
};

function blankCoverages() {
  return {
    cgl: {
      enabled: false,
      insrLtr: "",
      addlInsd: false,
      subrWvd: false,
      form: "occur", // 'occur' | 'claimsMade'
      policyNumber: "",
      eff: "",
      exp: "",
      aggregatePer: "policy", // policy | project | loc | other
      limits: { ...emptyLimits },
    },
    auto: {
      enabled: false,
      insrLtr: "",
      addlInsd: false,
      subrWvd: false,
      scope: "any", // any | owned | scheduled | hired | nonOwned
      policyNumber: "",
      eff: "",
      exp: "",
      limits: {
        combinedSingle: "",
        biPerson: "",
        biAccident: "",
        propertyDamage: "",
      },
    },
    umbrella: {
      enabled: false,
      insrLtr: "",
      form: "occur",
      policyNumber: "",
      eff: "",
      exp: "",
      limits: { eachOccurrence: "", aggregate: "" },
    },
    workersComp: {
      enabled: false,
      insrLtr: "",
      perStatute: false,
      limits: { eachAccident: "", diseaseEmployee: "", diseasePolicy: "" },
    },
    other: {
      enabled: false,
      insrLtr: "",
      label: "",
      policyNumber: "",
      eff: "",
      exp: "",
      limitText: "",
    },
  };
}

// ---- Request 1: TRUCKSOLUTIONS LLC (mirrors the supplied base PDF) ----
const truckSolutions = {
  id: "REQ-1042",
  status: "new",
  priority: "high",
  email: {
    fromName: "Highway App Dispatch",
    from: "coi@highwayapp.com",
    subject: "COI request — TRUCKSOLUTIONS LLC (MC onboarding)",
    receivedAt: "2026-07-08T13:12:00",
    preview:
      "Please issue a certificate of insurance naming Highway App, Inc. as certificate holder for TRUCKSOLUTIONS LLC before dispatch.",
    body: `Hi New Hope Insurance,

We are onboarding TRUCKSOLUTIONS LLC to our load board and need a current Certificate of Liability Insurance on file before we can dispatch.

Certificate holder should be:
Highway App, Inc.
5931 Greenville Ave. # 5620
Dallas, TX 75206

Please include Auto Liability and Motor Cargo, and list the covered vehicles.

Thanks,
Highway App Onboarding Team`,
    requestedCoverages: ["Auto Liability", "Motor Cargo"],
    holder: {
      name: "Highway App, Inc.",
      address: "5931 Greenville Ave. # 5620\nDallas, TX 75206",
    },
    descriptionOfOperations: `Vehicles:
2020 FRHT M2 106 MEDIUM DUTY  3ALACWFC1LDLW9109
2020 HINO 258/268  5PVNJ8JV4L5S80203
2019 HINO 258/268  5PVNJ8JV8K4S70570`,
  },
  ams: {
    clientNumber: "18823",
    clientName: "TRUCKSOLUTIONS LLC",
    matchConfidence: 0.98,
    address: "4932 Spruce Peak Rd\nCharlotte, NC 28278-6557",
    insurers: [
      { letter: "A", name: "Integon Indemnity Corporation", naic: "22772" },
      { letter: "B", name: "Hamilton Insurance DAC", naic: "13700" },
    ],
    policies: [
      {
        type: "auto",
        insrLtr: "A",
        policyNumber: "2024284451-01",
        eff: "08/07/2025",
        exp: "08/07/2026",
        scope: "scheduled",
        limits: { combinedSingle: "1,000,000", biPerson: "", biAccident: "", propertyDamage: "" },
      },
      {
        type: "other",
        insrLtr: "B",
        label: "Motor Cargo",
        policyNumber: "B1136PF25135591",
        eff: "06/04/2025",
        exp: "06/04/2026",
        limitText: "$100,000 / $1,000 DED",
      },
    ],
  },
};

// ---- Request 2: Stacy Innovations LLC (mirrors the AgencyOne demo video) ----
const stacy = {
  id: "REQ-1043",
  status: "new",
  priority: "normal",
  email: {
    fromName: "Innovations Media Co-op",
    from: "accounts@innovationsmedia.co",
    subject: "Certificate of Insurance needed for vendor agreement",
    receivedAt: "2026-07-08T11:47:00",
    preview:
      "We need a COI for Stacy Innovations LLC showing General Liability to complete vendor onboarding.",
    body: `Hello,

To finalize our vendor agreement with Stacy Innovations LLC, our compliance team requires a Certificate of Liability Insurance evidencing General Liability coverage.

Please list us as certificate holder:
Innovations Media Co-op
55 Kent Ave, Brooklyn, NY 11249

Best regards,
Accounts Payable`,
    requestedCoverages: ["General Liability"],
    holder: {
      name: "Innovations Media Co-op",
      address: "55 Kent Ave\nBrooklyn, NY 11249",
    },
    descriptionOfOperations:
      "Certificate issued to evidence General Liability coverage per vendor services agreement.",
  },
  ams: {
    clientNumber: "21589",
    clientName: "Stacy Innovations LLC",
    matchConfidence: 0.95,
    address: "148 W 37th St, 9th Floor\nManhattan, NY 10018",
    insurers: [{ letter: "A", name: "The New York State Ins Fund", naic: "26212" }],
    policies: [
      {
        type: "cgl",
        insrLtr: "A",
        policyNumber: "CPP-001",
        eff: "01/01/2026",
        exp: "01/01/2027",
        form: "occur",
        aggregatePer: "policy",
        limits: {
          eachOccurrence: "1,000,000",
          damageToRented: "300,000",
          medExp: "10,000",
          personalAdvInjury: "1,000,000",
          generalAggregate: "2,000,000",
          productsCompOp: "2,000,000",
        },
      },
    ],
  },
};

// ---- Request 3: Meridian Logistics LLC ----
const meridian = {
  id: "REQ-1044",
  status: "new",
  priority: "normal",
  email: {
    fromName: "Cornerstone Freight Brokers",
    from: "compliance@cornerstonefreight.com",
    subject: "Insurance certificate — Meridian Logistics LLC",
    receivedAt: "2026-07-08T09:20:00",
    preview:
      "Requesting a COI with Auto Liability and General Liability for Meridian Logistics LLC.",
    body: `Team,

Before we can tender loads to Meridian Logistics LLC we need a certificate of insurance on file showing General Liability and Auto Liability.

Certificate holder:
Cornerstone Freight Brokers
900 W Trade St, Suite 200, Charlotte, NC 28202

Regards,
Compliance`,
    requestedCoverages: ["General Liability", "Auto Liability"],
    holder: {
      name: "Cornerstone Freight Brokers",
      address: "900 W Trade St, Suite 200\nCharlotte, NC 28202",
    },
    descriptionOfOperations:
      "Certificate holder is named as additional insured with respect to general liability where required by written contract.",
  },
  ams: {
    clientNumber: "19457",
    clientName: "Meridian Logistics LLC",
    matchConfidence: 0.91,
    address: "1180 Innovation Way\nCharlotte, NC 28273",
    insurers: [
      { letter: "A", name: "Progressive Commercial", naic: "24260" },
      { letter: "B", name: "Nationwide Mutual Ins Co", naic: "23787" },
    ],
    policies: [
      {
        type: "cgl",
        insrLtr: "B",
        policyNumber: "GL-7789021",
        eff: "05/15/2026",
        exp: "05/15/2027",
        form: "occur",
        aggregatePer: "policy",
        limits: {
          eachOccurrence: "1,000,000",
          damageToRented: "100,000",
          medExp: "5,000",
          personalAdvInjury: "1,000,000",
          generalAggregate: "2,000,000",
          productsCompOp: "2,000,000",
        },
      },
      {
        type: "auto",
        insrLtr: "A",
        policyNumber: "CA-3391847",
        eff: "05/15/2026",
        exp: "05/15/2027",
        scope: "any",
        limits: { combinedSingle: "1,000,000", biPerson: "", biAccident: "", propertyDamage: "" },
      },
    ],
  },
};

export const SEED_REQUESTS = [truckSolutions, stacy, meridian];

// Pool used by the "Simulate incoming request" button.
export const SIMULATED_POOL = [
  {
    idBase: "REQ",
    email: {
      fromName: "Blue Ridge Contractors",
      from: "ap@blueridgecontractors.com",
      subject: "COI request for subcontractor agreement",
      preview: "Need a certificate showing GL and Workers' Comp for the project at 400 Tryon.",
      body: `Hi,

We need a certificate of insurance from Apex Builders LLC showing General Liability and Workers' Compensation before they can begin work on our 400 Tryon project.

Certificate holder:
Blue Ridge Contractors
400 S Tryon St, Charlotte, NC 28202

Thank you.`,
      requestedCoverages: ["General Liability", "Workers' Comp"],
      holder: {
        name: "Blue Ridge Contractors",
        address: "400 S Tryon St\nCharlotte, NC 28202",
      },
      descriptionOfOperations:
        "Subcontractor operations at 400 S Tryon St. Certificate holder is additional insured per written contract.",
    },
    ams: {
      clientNumber: "20114",
      clientName: "Apex Builders LLC",
      matchConfidence: 0.93,
      address: "77 Commerce Park Dr\nHuntersville, NC 28078",
      insurers: [
        { letter: "A", name: "The Hartford", naic: "29424" },
        { letter: "B", name: "AmTrust Financial", naic: "12777" },
      ],
      policies: [
        {
          type: "cgl",
          insrLtr: "A",
          policyNumber: "GL-556231",
          eff: "03/01/2026",
          exp: "03/01/2027",
          form: "occur",
          aggregatePer: "policy",
          limits: {
            eachOccurrence: "1,000,000",
            damageToRented: "100,000",
            medExp: "5,000",
            personalAdvInjury: "1,000,000",
            generalAggregate: "2,000,000",
            productsCompOp: "2,000,000",
          },
        },
        {
          type: "workersComp",
          insrLtr: "B",
          policyNumber: "WC-889201",
          eff: "03/01/2026",
          exp: "03/01/2027",
          perStatute: true,
          limits: { eachAccident: "1,000,000", diseaseEmployee: "1,000,000", diseasePolicy: "1,000,000" },
        },
      ],
    },
  },
  {
    idBase: "REQ",
    email: {
      fromName: "Harbor Point Property Mgmt",
      from: "insurance@harborpointpm.com",
      subject: "Certificate of insurance — landscaping vendor",
      preview: "Requesting COI with General Liability for Evergreen Grounds LLC.",
      body: `Hello,

Please provide a certificate of insurance for Evergreen Grounds LLC evidencing General Liability coverage for landscaping services at our properties.

Certificate holder:
Harbor Point Property Management
1500 Marina Blvd, Wilmington, NC 28401

Thanks!`,
      requestedCoverages: ["General Liability"],
      holder: {
        name: "Harbor Point Property Management",
        address: "1500 Marina Blvd\nWilmington, NC 28401",
      },
      descriptionOfOperations:
        "Landscaping and grounds maintenance services. Certificate holder is additional insured where required by contract.",
    },
    ams: {
      clientNumber: "22076",
      clientName: "Evergreen Grounds LLC",
      matchConfidence: 0.9,
      address: "22 Greenfield Rd\nWilmington, NC 28403",
      insurers: [{ letter: "A", name: "Travelers Indemnity Co", naic: "25658" }],
      policies: [
        {
          type: "cgl",
          insrLtr: "A",
          policyNumber: "GL-334410",
          eff: "02/01/2026",
          exp: "02/01/2027",
          form: "occur",
          aggregatePer: "policy",
          limits: {
            eachOccurrence: "1,000,000",
            damageToRented: "100,000",
            medExp: "5,000",
            personalAdvInjury: "1,000,000",
            generalAggregate: "2,000,000",
            productsCompOp: "2,000,000",
          },
        },
      ],
    },
  },
];

// Merge AMS policies + email holder into a full ACORD 25 certificate object.
export function buildCertificate(request) {
  const cov = blankCoverages();
  for (const p of request.ams.policies) {
    if (p.type === "cgl") {
      cov.cgl = {
        ...cov.cgl,
        enabled: true,
        insrLtr: p.insrLtr,
        addlInsd: true,
        form: p.form || "occur",
        policyNumber: p.policyNumber,
        eff: p.eff,
        exp: p.exp,
        aggregatePer: p.aggregatePer || "policy",
        limits: { ...cov.cgl.limits, ...p.limits },
      };
    } else if (p.type === "auto") {
      cov.auto = {
        ...cov.auto,
        enabled: true,
        insrLtr: p.insrLtr,
        scope: p.scope || "any",
        policyNumber: p.policyNumber,
        eff: p.eff,
        exp: p.exp,
        limits: { ...cov.auto.limits, ...p.limits },
      };
    } else if (p.type === "umbrella") {
      cov.umbrella = { ...cov.umbrella, enabled: true, insrLtr: p.insrLtr, policyNumber: p.policyNumber, eff: p.eff, exp: p.exp, limits: { ...cov.umbrella.limits, ...p.limits } };
    } else if (p.type === "workersComp") {
      cov.workersComp = {
        ...cov.workersComp,
        enabled: true,
        insrLtr: p.insrLtr,
        perStatute: !!p.perStatute,
        limits: { ...cov.workersComp.limits, ...p.limits },
      };
    } else if (p.type === "other") {
      cov.other = {
        ...cov.other,
        enabled: true,
        insrLtr: p.insrLtr,
        label: p.label,
        policyNumber: p.policyNumber,
        eff: p.eff,
        exp: p.exp,
        limitText: p.limitText || "",
      };
    }
  }

  return {
    date: "07/08/2026",
    certificateNumber: `000${Math.floor(20000 + (parseInt(request.ams.clientNumber, 10) % 9000))}-0`,
    revisionNumber: "",
    producer: { ...AGENCY_PRODUCER },
    insured: {
      name: request.ams.clientName,
      address: request.ams.address,
    },
    insurers: request.ams.insurers,
    coverages: cov,
    descriptionOfOperations: request.email.descriptionOfOperations || "",
    holder: { ...request.email.holder },
    authorizedRep: "Axel Moreno",
    signatureMode: "signature", // 'signature' | 'wet'
  };
}
