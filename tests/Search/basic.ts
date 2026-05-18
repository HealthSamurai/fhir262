import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { ServerInstance } from "../../interfaces/server";
import { loadImpl } from "../../framework/impl-loader";

const server = loadImpl().server;
let instance: ServerInstance;

beforeAll(async () => {
  instance = await server.startWithCoreOnly("r4");
});

afterAll(async () => {
  await instance.stop();
});

type Bundle = {
  resourceType: "Bundle";
  total?: number;
  entry?: { resource: { id: string; resourceType: string } }[];
  link?: { relation: string; url: string }[];
};

const idsOf = (b: unknown): string[] =>
  ((b as Bundle).entry ?? []).map((e) => e.resource.id);

const createOrFail = async (type: string, resource: unknown): Promise<string> => {
  const res = await instance.rest.create(type, resource);
  if (res.status !== 201) {
    throw new Error(
      `create ${type} failed: ${res.status} ${JSON.stringify(res.body, null, 2)}\n` +
        `resource: ${JSON.stringify(resource, null, 2)}`,
    );
  }
  const id = (res.body as { id?: string }).id;
  if (!id) throw new Error(`create ${type} returned no id`);
  return id;
};

const cleanup = async (type: string, ids: string[]) => {
  for (const id of ids) await instance.rest.delete(type, id);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const IDENT_SYSTEM = "http://fhir262/test";

describe("by-type-general", () => {
  let orgId: string;
  let pA: string;
  let pB: string;
  let pC: string;
  let pD: string;
  let pE: string;

  beforeAll(async () => {
    orgId = await createOrFail("Organization", {
      resourceType: "Organization",
      name: "fhir262 Org",
    });
    pA = await createOrFail("Patient", {
      resourceType: "Patient",
      identifier: [{ system: IDENT_SYSTEM, value: "MRN-001" }],
      name: [{ family: "Smith", given: ["John"] }],
      gender: "male",
      birthDate: "1980-01-15",
      managingOrganization: { reference: `Organization/${orgId}` },
    });
    pB = await createOrFail("Patient", {
      resourceType: "Patient",
      identifier: [{ system: IDENT_SYSTEM, value: "MRN-002" }],
      name: [{ family: "Jones", given: ["Jane"] }],
      gender: "female",
      birthDate: "1990-06-20",
    });
    pC = await createOrFail("Patient", {
      resourceType: "Patient",
      identifier: [{ system: IDENT_SYSTEM, value: "MRN-003" }],
      name: [{ family: "Smithson", given: ["Sam"] }],
      gender: "female",
      birthDate: "2000-12-31",
    });
    // No IDENT_SYSTEM identifier on pD/pE to keep _total=accurate at 3.
    pD = await createOrFail("Patient", {
      resourceType: "Patient",
      name: [{ family: "Muñoz", given: ["Maria"] }],
    });
    pE = await createOrFail("Patient", {
      resourceType: "Patient",
      name: [{ family: "Van Helsing", given: ["Abraham"] }],
    });
  });

  afterAll(async () => {
    await cleanup("Patient", [pA, pB, pC, pD, pE]);
    await cleanup("Organization", [orgId]);
  });

  it("token: identifier matches exact system|value", async () => {
    const res = await instance.rest.search("Patient", `identifier=${IDENT_SYSTEM}|MRN-001`);
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(pA);
    expect(ids).not.toContain(pB);
    expect(ids).not.toContain(pC);
  });

  it("string: family does case-insensitive prefix match", async () => {
    const res = await instance.rest.search("Patient", "family=smi");
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toEqual(expect.arrayContaining([pA, pC]));
    expect(ids).not.toContain(pB);
  });

  it("string: family is accent-insensitive", async () => {
    const res = await instance.rest.search("Patient", "family=munoz");
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(pD);
  });

  it("string: family matches only at the start (mid-string substring does not match)", async () => {
    const res = await instance.rest.search("Patient", "family=oz");
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).not.toContain(pD);
  });

  it("string: family value may contain spaces", async () => {
    const res = await instance.rest.search(
      "Patient",
      `family=${encodeURIComponent("Van Hel")}`,
    );
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(pE);
    expect(ids).not.toContain(pA);
  });

  it("date: birthdate=ge filters earlier dates out", async () => {
    const res = await instance.rest.search("Patient", "birthdate=ge1985-01-01");
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toEqual(expect.arrayContaining([pB, pC]));
    expect(ids).not.toContain(pA);
  });

  it("reference: organization=Organization/{id} matches the linked patient", async () => {
    const res = await instance.rest.search("Patient", `organization=Organization/${orgId}`);
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(pA);
    expect(ids).not.toContain(pB);
    expect(ids).not.toContain(pC);
  });

  it("total: _total=accurate returns exact count", async () => {
    const res = await instance.rest.search(
      "Patient",
      `identifier=${IDENT_SYSTEM}|&_total=accurate`,
    );
    expect(res).toHaveStatus(200);
    expect((res.body as Bundle).total).toBe(3);
  });
});

describe("system", () => {
  const tPast = "2000-01-01T00:00:00Z";
  const tFuture = "2999-01-01T00:00:00Z";
  let p1: string;
  let p2: string;

  beforeAll(async () => {
    p1 = await createOrFail("Patient", { resourceType: "Patient", gender: "male" });
    p2 = await createOrFail("Patient", { resourceType: "Patient", gender: "female" });
  });

  afterAll(async () => {
    await cleanup("Patient", [p1, p2]);
  });

  it("_id matches a single id exactly", async () => {
    const res = await instance.rest.search("Patient", `_id=${p1}`);
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual([p1]);
  });

  it("_lastUpdated=ge<past> matches both patients", async () => {
    const res = await instance.rest.search("Patient", `_lastUpdated=ge${tPast}`);
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([p1, p2]));
  });

  it("_lastUpdated=ge<future> matches none", async () => {
    const res = await instance.rest.search("Patient", `_lastUpdated=ge${tFuture}`);
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual([]);
  });
});

describe("sort", () => {
  let s1: string;
  let s2: string;
  let s3: string;

  beforeAll(async () => {
    s1 = await createOrFail("Patient", {
      resourceType: "Patient",
      identifier: [{ system: IDENT_SYSTEM, value: "MRN-S1" }],
      birthDate: "1990-01-01",
    });
    await sleep(20);
    s2 = await createOrFail("Patient", {
      resourceType: "Patient",
      identifier: [{ system: IDENT_SYSTEM, value: "MRN-S2" }],
      birthDate: "1980-01-01",
    });
    await sleep(20);
    s3 = await createOrFail("Patient", {
      resourceType: "Patient",
      identifier: [{ system: IDENT_SYSTEM, value: "MRN-S3" }],
      birthDate: "2000-01-01",
    });
  });

  afterAll(async () => {
    await cleanup("Patient", [s1, s2, s3]);
  });

  it("_sort=birthdate sorts ascending", async () => {
    const res = await instance.rest.search(
      "Patient",
      `identifier=${IDENT_SYSTEM}|&_sort=birthdate`,
    );
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual([s2, s1, s3]);
  });

  it("_sort=-birthdate sorts descending", async () => {
    const res = await instance.rest.search(
      "Patient",
      `identifier=${IDENT_SYSTEM}|&_sort=-birthdate`,
    );
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual([s3, s1, s2]);
  });

  it("_sort=-_lastUpdated sorts by a system search param", async () => {
    const res = await instance.rest.search(
      "Patient",
      `identifier=${IDENT_SYSTEM}|&_sort=-_lastUpdated`,
    );
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual([s3, s2, s1]);
  });
});

describe("paging", () => {
  const ids: string[] = [];

  beforeAll(async () => {
    for (let i = 1; i <= 5; i++) {
      const id = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: `P-${i}` }],
      });
      ids.push(id);
    }
  });

  afterAll(async () => {
    await cleanup("Patient", ids);
  });

  it("_count=2 returns at most 2 entries and a next link", async () => {
    const res = await instance.rest.search(
      "Patient",
      `identifier=${IDENT_SYSTEM}|&_count=2`,
    );
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body).length).toBeLessThanOrEqual(2);
  });

});

describe("joins-and-or", () => {
  let pAB: string;
  let pA: string;
  let pB: string;
  let pC: string;
  let aMB: string;
  let aM: string;
  let aB: string;
  let aF: string;

  beforeAll(async () => {
    pAB = await createOrFail("Patient", {
      resourceType: "Patient",
      identifier: [{ system: IDENT_SYSTEM, value: "JOIN-1" }],
      name: [{ family: "Smith", given: ["Alex", "Bob"] }],
      birthDate: "1985-06-15",
    });
    pA = await createOrFail("Patient", {
      resourceType: "Patient",
      identifier: [{ system: IDENT_SYSTEM, value: "JOIN-2" }],
      name: [{ family: "Doe", given: ["Alex"] }],
      birthDate: "2010-03-01",
    });
    pB = await createOrFail("Patient", {
      resourceType: "Patient",
      identifier: [{ system: IDENT_SYSTEM, value: "JOIN-3" }],
      name: [{ family: "Doe", given: ["Bob"] }],
      birthDate: "1970-01-01",
    });
    pC = await createOrFail("Patient", {
      resourceType: "Patient",
      identifier: [{ system: IDENT_SYSTEM, value: "JOIN-4" }],
      name: [{ family: "Smith", given: ["Carol"] }],
      birthDate: "2000-05-20",
    });

    const allergy = (idValue: string, categories: string[]) => ({
      resourceType: "AllergyIntolerance",
      identifier: [{ system: IDENT_SYSTEM, value: idValue }],
      patient: { reference: `Patient/${pAB}` },
      category: categories,
      clinicalStatus: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
            code: "active",
          },
        ],
      },
    });
    aMB = await createOrFail("AllergyIntolerance", allergy("JOIN-A1", ["medication", "biologic"]));
    aM = await createOrFail("AllergyIntolerance", allergy("JOIN-A2", ["medication"]));
    aB = await createOrFail("AllergyIntolerance", allergy("JOIN-A3", ["biologic"]));
    aF = await createOrFail("AllergyIntolerance", allergy("JOIN-A4", ["food"]));
  });

  afterAll(async () => {
    await cleanup("AllergyIntolerance", [aMB, aM, aB, aF]);
    await cleanup("Patient", [pAB, pA, pB, pC]);
  });

  it("AND across params: given + family must both match", async () => {
    const res = await instance.rest.search("Patient", "given=Alex&family=Doe");
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(pA);
    expect(ids).not.toContain(pAB);
    expect(ids).not.toContain(pB);
    expect(ids).not.toContain(pC);
  });

  it("AND repeated on scalar-simple: birthdate range narrows to inside the range", async () => {
    const res = await instance.rest.search(
      "Patient",
      "birthdate=ge1980-01-01&birthdate=lt2000-01-01",
    );
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(pAB);
    expect(ids).not.toContain(pA);
    expect(ids).not.toContain(pB);
    expect(ids).not.toContain(pC);
  });

  it("AND repeated on array-simple: category=medication&category=biologic requires both", async () => {
    const res = await instance.rest.search(
      "AllergyIntolerance",
      "category=medication&category=biologic",
    );
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(aMB);
    expect(ids).not.toContain(aM);
    expect(ids).not.toContain(aB);
    expect(ids).not.toContain(aF);
  });

  it("AND repeated on array-complex: name=Alex&name=Smith spans given + family", async () => {
    const res = await instance.rest.search("Patient", "name=Alex&name=Smith");
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(pAB);
    expect(ids).not.toContain(pA);
    expect(ids).not.toContain(pB);
    expect(ids).not.toContain(pC);
  });

  it("OR via comma on array-complex: given=Alex,Carol", async () => {
    const res = await instance.rest.search("Patient", "given=Alex,Carol");
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toEqual(expect.arrayContaining([pAB, pA, pC]));
    expect(ids).not.toContain(pB);
  });

  it("OR with prefix per value: birthdate outside [1975, 2005)", async () => {
    const res = await instance.rest.search(
      "Patient",
      "birthdate=ge2005-01-01,lt1975-01-01",
    );
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toEqual(expect.arrayContaining([pA, pB]));
    expect(ids).not.toContain(pAB);
    expect(ids).not.toContain(pC);
  });

  it("OR with modifier applies to each value: given:exact=Alex,Carol", async () => {
    const res = await instance.rest.search("Patient", "given:exact=Alex,Carol");
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toEqual(expect.arrayContaining([pAB, pA, pC]));
    expect(ids).not.toContain(pB);
  });

  it("OR on array-simple: category=medication,biologic", async () => {
    const res = await instance.rest.search(
      "AllergyIntolerance",
      "category=medication,biologic",
    );
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toEqual(expect.arrayContaining([aMB, aM, aB]));
    expect(ids).not.toContain(aF);
  });

  it("OR on array-complex via name parameter: name=Doe,Smith", async () => {
    const res = await instance.rest.search("Patient", "name=Doe,Smith");
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toEqual(expect.arrayContaining([pAB, pA, pB, pC]));
  });

  it("MIX: AND between params with OR within one — given=Alex,Bob & family=Smith", async () => {
    const res = await instance.rest.search("Patient", "given=Alex,Bob&family=Smith");
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(pAB);
    expect(ids).not.toContain(pA);
    expect(ids).not.toContain(pB);
    expect(ids).not.toContain(pC);
  });
});

describe("modifiers", () => {
  describe("exact (string)", () => {
    let pS: string;
    let pSn: string;
    let psm: string;

    beforeAll(async () => {
      pS = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "EX-1" }],
        name: [{ family: "Smith" }],
      });
      pSn = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "EX-2" }],
        name: [{ family: "Smithson" }],
      });
      psm = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "EX-3" }],
        name: [{ family: "smith" }],
      });
    });

    afterAll(async () => {
      await cleanup("Patient", [pS, pSn, psm]);
    });

    it("family:exact=Smith requires full-string and matching case", async () => {
      const res = await instance.rest.search("Patient", "family:exact=Smith");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(pS);
      expect(ids).not.toContain(pSn);
      expect(ids).not.toContain(psm);
    });

    it("family:exact=smith matches only the lowercase-stored value", async () => {
      const res = await instance.rest.search("Patient", "family:exact=smith");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(psm);
      expect(ids).not.toContain(pS);
      expect(ids).not.toContain(pSn);
    });
  });

  describe("contains (string, uri)", () => {
    let pAnd: string;
    let pSon: string;
    let pSam: string;
    let pBr: string;
    let vsAcme: string;
    let vsEx: string;

    beforeAll(async () => {
      pAnd = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "CT-1" }],
        name: [{ family: "Anderson" }],
      });
      pSon = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "CT-2" }],
        name: [{ family: "Sonder" }],
      });
      pSam = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "CT-3" }],
        name: [{ family: "Samsonite" }],
      });
      pBr = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "CT-4" }],
        name: [{ family: "Brown" }],
      });
      vsAcme = await createOrFail("ValueSet", {
        resourceType: "ValueSet",
        url: "http://acme.org/fhir/ValueSet/foo",
        status: "active",
      });
      vsEx = await createOrFail("ValueSet", {
        resourceType: "ValueSet",
        url: "http://example.org/fhir/ValueSet/bar",
        status: "active",
      });
    });

    afterAll(async () => {
      await cleanup("Patient", [pAnd, pSon, pSam, pBr]);
      await cleanup("ValueSet", [vsAcme, vsEx]);
    });

    it("family:contains=son matches substring anywhere (Anderson, Sonder, Samsonite)", async () => {
      const res = await instance.rest.search("Patient", "family:contains=son");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([pAnd, pSon, pSam]));
      expect(ids).not.toContain(pBr);
    });

    it("family:contains=SON is case-insensitive", async () => {
      const res = await instance.rest.search("Patient", "family:contains=SON");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([pAnd, pSon, pSam]));
      expect(ids).not.toContain(pBr);
    });

    it("url:contains=acme matches a URI substring on ValueSet", async () => {
      const res = await instance.rest.search("ValueSet", "url:contains=acme");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(vsAcme);
      expect(ids).not.toContain(vsEx);
    });
  });

  describe("missing (date, string, token)", () => {
    let pFull: string;
    let pEmpty: string;

    beforeAll(async () => {
      pFull = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "MI-1" }],
        gender: "male",
        birthDate: "1980-01-01",
      });
      pEmpty = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "MI-2" }],
      });
    });

    afterAll(async () => {
      await cleanup("Patient", [pFull, pEmpty]);
    });

    it("gender:missing=true matches records without gender", async () => {
      const res = await instance.rest.search("Patient", "gender:missing=true");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(pEmpty);
      expect(ids).not.toContain(pFull);
    });

    it("gender:missing=false matches records with gender", async () => {
      const res = await instance.rest.search("Patient", "gender:missing=false");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(pFull);
      expect(ids).not.toContain(pEmpty);
    });

    it("birthdate:missing=true matches records without birthDate", async () => {
      const res = await instance.rest.search("Patient", "birthdate:missing=true");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(pEmpty);
      expect(ids).not.toContain(pFull);
    });

    it("birthdate:missing=false matches records with birthDate", async () => {
      const res = await instance.rest.search("Patient", "birthdate:missing=false");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(pFull);
      expect(ids).not.toContain(pEmpty);
    });
  });

  describe("not (token)", () => {
    let pMale: string;
    let pFem: string;
    let pOth: string;
    let pNone: string;

    beforeAll(async () => {
      pMale = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "NT-1" }],
        gender: "male",
      });
      pFem = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "NT-2" }],
        gender: "female",
      });
      pOth = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "NT-3" }],
        gender: "other",
      });
      pNone = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "NT-4" }],
      });
    });

    afterAll(async () => {
      await cleanup("Patient", [pMale, pFem, pOth, pNone]);
    });

    it("gender:not=male excludes male and INCLUDES records with no gender", async () => {
      const res = await instance.rest.search("Patient", "gender:not=male");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([pFem, pOth, pNone]));
      expect(ids).not.toContain(pMale);
    });
  });

  describe("of-type (Identifier)", () => {
    const V2_0203 = "http://terminology.hl7.org/CodeSystem/v2-0203";
    let pMR: string;
    let pMRT: string;
    let pMRX: string;

    beforeAll(async () => {
      pMR = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [
          { system: IDENT_SYSTEM, value: "OT-1" },
          {
            type: { coding: [{ system: V2_0203, code: "MR" }] },
            value: "12345",
          },
        ],
      });
      pMRT = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [
          { system: IDENT_SYSTEM, value: "OT-2" },
          {
            type: { coding: [{ system: V2_0203, code: "MRT" }] },
            value: "12345",
          },
        ],
      });
      pMRX = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [
          { system: IDENT_SYSTEM, value: "OT-3" },
          {
            type: { coding: [{ system: V2_0203, code: "MR" }] },
            value: "99999",
          },
        ],
      });
    });

    afterAll(async () => {
      await cleanup("Patient", [pMR, pMRT, pMRX]);
    });

    it("full system|code|value match", async () => {
      const res = await instance.rest.search(
        "Patient",
        `identifier:of-type=${V2_0203}|MR|12345`,
      );
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(pMR);
      expect(ids).not.toContain(pMRT);
      expect(ids).not.toContain(pMRX);
    });

    it("different code does not match", async () => {
      const res = await instance.rest.search(
        "Patient",
        `identifier:of-type=${V2_0203}|MRT|12345`,
      );
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(pMRT);
      expect(ids).not.toContain(pMR);
      expect(ids).not.toContain(pMRX);
    });

    it("different value does not match", async () => {
      const res = await instance.rest.search(
        "Patient",
        `identifier:of-type=${V2_0203}|MR|99999`,
      );
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(pMRX);
      expect(ids).not.toContain(pMR);
      expect(ids).not.toContain(pMRT);
    });
  });
});

describe("date", () => {
  describe("date — Patient.birthDate", () => {
    let p_y80: string;
    let p_d80: string;
    let p_y90: string;
    let p_ym90: string;
    let p_d90: string;
    let p_d90end: string;
    let p_y00: string;

    beforeAll(async () => {
      p_y80 = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-D-1" }],
        birthDate: "1980",
      });
      p_d80 = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-D-2" }],
        birthDate: "1980-06-15",
      });
      p_y90 = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-D-3" }],
        birthDate: "1990",
      });
      p_ym90 = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-D-4" }],
        birthDate: "1990-06",
      });
      p_d90 = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-D-5" }],
        birthDate: "1990-06-15",
      });
      p_d90end = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-D-6" }],
        birthDate: "1990-12-31",
      });
      p_y00 = await createOrFail("Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-D-7" }],
        birthDate: "2000",
      });
    });

    afterAll(async () => {
      await cleanup("Patient", [p_y80, p_d80, p_y90, p_ym90, p_d90, p_d90end, p_y00]);
    });

    it("no-prefix year: birthdate=1990 matches all 1990 fixtures", async () => {
      const res = await instance.rest.search("Patient", "birthdate=1990");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([p_y90, p_ym90, p_d90, p_d90end]));
      expect(ids).not.toContain(p_y80);
      expect(ids).not.toContain(p_d80);
      expect(ids).not.toContain(p_y00);
    });

    it("explicit eq year: birthdate=eq1990 matches all 1990 fixtures", async () => {
      const res = await instance.rest.search("Patient", "birthdate=eq1990");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([p_y90, p_ym90, p_d90, p_d90end]));
      expect(ids).not.toContain(p_y80);
      expect(ids).not.toContain(p_d80);
      expect(ids).not.toContain(p_y00);
    });

    // (= `eq`), the search range must FULLY CONTAIN the resource's implicit range.
    // Query `1990-06` ⇒ [1990-06-01, 1990-07-01); only resources whose own range
    // fits inside that month match — so `p_y90` ("1990", range [1990-01-01,
    // 1991-01-01)) is excluded for being wider than the query, even though
    // June 1990 is "inside" 1990. This is the partial-precision asymmetry.
    it("no-prefix month: birthdate=             1990-06 narrows to June 1990 fixtures", async () => {
      const res = await instance.rest.search("Patient", "birthdate=1990-06");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([p_ym90, p_d90]));
      expect(ids).not.toContain(p_y90);
      expect(ids).not.toContain(p_d90end);
      expect(ids).not.toContain(p_y80);
      expect(ids).not.toContain(p_d80);
      expect(ids).not.toContain(p_y00);
    });

    it("explicit eq month: birthdate=eq1990-06", async () => {
      const res = await instance.rest.search("Patient", "birthdate=eq1990-06");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([p_ym90, p_d90]));
      expect(ids).not.toContain(p_y90);
      expect(ids).not.toContain(p_d90end);
      expect(ids).not.toContain(p_y80);
      expect(ids).not.toContain(p_d80);
      expect(ids).not.toContain(p_y00);
    });

    it("no-prefix day: birthdate=1990-06-15 matches only the day fixture", async () => {
      const res = await instance.rest.search("Patient", "birthdate=1990-06-15");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(p_d90);
      expect(ids).not.toContain(p_y90);
      expect(ids).not.toContain(p_ym90);
      expect(ids).not.toContain(p_d90end);
      expect(ids).not.toContain(p_y80);
      expect(ids).not.toContain(p_d80);
      expect(ids).not.toContain(p_y00);
    });

    it("explicit eq day: birthdate=eq1990-06-15", async () => {
      const res = await instance.rest.search("Patient", "birthdate=eq1990-06-15");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(p_d90);
      expect(ids).not.toContain(p_y90);
      expect(ids).not.toContain(p_ym90);
      expect(ids).not.toContain(p_d90end);
      expect(ids).not.toContain(p_y80);
      expect(ids).not.toContain(p_d80);
      expect(ids).not.toContain(p_y00);
    });

    it("ne year: birthdate=ne1990 excludes all 1990 fixtures", async () => {
      const res = await instance.rest.search("Patient", "birthdate=ne1990");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([p_y80, p_d80, p_y00]));
      expect(ids).not.toContain(p_y90);
      expect(ids).not.toContain(p_ym90);
      expect(ids).not.toContain(p_d90);
      expect(ids).not.toContain(p_d90end);
    });

    it("gt year: birthdate=gt1990 requires strict upper > 1991-01-01", async () => {
      const res = await instance.rest.search("Patient", "birthdate=gt1990");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(p_y00);
      expect(ids).not.toContain(p_y90);
      expect(ids).not.toContain(p_ym90);
      expect(ids).not.toContain(p_d90);
      expect(ids).not.toContain(p_d90end);
      expect(ids).not.toContain(p_y80);
      expect(ids).not.toContain(p_d80);
    });

    it("gt day: birthdate=gt1990-06-15 includes coarse-precision resources whose upper extends past", async () => {
      const res = await instance.rest.search("Patient", "birthdate=gt1990-06-15");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([p_y90, p_ym90, p_d90end, p_y00]));
      expect(ids).not.toContain(p_d90);
      expect(ids).not.toContain(p_y80);
      expect(ids).not.toContain(p_d80);
    });

    it("gt month: birthdate=gt1990-06 requires upper > 1990-07-01", async () => {
      const res = await instance.rest.search("Patient", "birthdate=gt1990-06");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([p_y90, p_d90end, p_y00]));
      expect(ids).not.toContain(p_ym90);
      expect(ids).not.toContain(p_d90);
      expect(ids).not.toContain(p_y80);
      expect(ids).not.toContain(p_d80);
    });

    it("ge year: birthdate=ge1990 includes 1990 and later", async () => {
      const res = await instance.rest.search("Patient", "birthdate=ge1990");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(
        expect.arrayContaining([p_y90, p_ym90, p_d90, p_d90end, p_y00]),
      );
      expect(ids).not.toContain(p_y80);
      expect(ids).not.toContain(p_d80);
    });

    it("lt year: birthdate=lt1990 keeps only strictly-earlier fixtures", async () => {
      const res = await instance.rest.search("Patient", "birthdate=lt1990");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([p_y80, p_d80]));
      expect(ids).not.toContain(p_y90);
      expect(ids).not.toContain(p_ym90);
      expect(ids).not.toContain(p_d90);
      expect(ids).not.toContain(p_d90end);
      expect(ids).not.toContain(p_y00);
    });

    it("lt day: birthdate=lt1990-06-15 includes coarse 1990s whose lower precedes the day", async () => {
      const res = await instance.rest.search("Patient", "birthdate=lt1990-06-15");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([p_y80, p_d80, p_y90, p_ym90]));
      expect(ids).not.toContain(p_d90);
      expect(ids).not.toContain(p_d90end);
      expect(ids).not.toContain(p_y00);
    });

    it("le year: birthdate=le1990 includes 1980s and 1990s", async () => {
      const res = await instance.rest.search("Patient", "birthdate=le1990");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(
        expect.arrayContaining([p_y80, p_d80, p_y90, p_ym90, p_d90, p_d90end]),
      );
      expect(ids).not.toContain(p_y00);
    });

    it("sa year: birthdate=sa1990 collapses to strict-after on point ranges", async () => {
      const res = await instance.rest.search("Patient", "birthdate=sa1990");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(p_y00);
      expect(ids).not.toContain(p_y90);
      expect(ids).not.toContain(p_ym90);
      expect(ids).not.toContain(p_d90);
      expect(ids).not.toContain(p_d90end);
      expect(ids).not.toContain(p_y80);
      expect(ids).not.toContain(p_d80);
    });

    it("eb year: birthdate=eb1990 collapses to strict-before on point ranges", async () => {
      const res = await instance.rest.search("Patient", "birthdate=eb1990");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([p_y80, p_d80]));
      expect(ids).not.toContain(p_y90);
      expect(ids).not.toContain(p_ym90);
      expect(ids).not.toContain(p_d90);
      expect(ids).not.toContain(p_d90end);
      expect(ids).not.toContain(p_y00);
    });

  });

  describe("dateTime — Observation.effective", () => {
    const obsCode = {
      coding: [{ system: "http://loinc.org", code: "8480-6" }],
    };
    let o_y20: string;
    let o_ym20_06: string;
    let o_d20: string;
    let o_inst_utc: string;
    let o_inst_tz: string;
    let o_inst_late: string;
    let o_next: string;
    let o_y21: string;

    beforeAll(async () => {
      o_y20 = await createOrFail("Observation", {
        resourceType: "Observation",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-T-1" }],
        status: "final",
        code: obsCode,
        effectiveDateTime: "2020",
      });
      o_ym20_06 = await createOrFail("Observation", {
        resourceType: "Observation",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-T-2" }],
        status: "final",
        code: obsCode,
        effectiveDateTime: "2020-06",
      });
      o_d20 = await createOrFail("Observation", {
        resourceType: "Observation",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-T-3" }],
        status: "final",
        code: obsCode,
        effectiveDateTime: "2020-06-15",
      });
      o_inst_utc = await createOrFail("Observation", {
        resourceType: "Observation",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-T-4" }],
        status: "final",
        code: obsCode,
        effectiveDateTime: "2020-06-15T10:30:00Z",
      });
      o_inst_tz = await createOrFail("Observation", {
        resourceType: "Observation",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-T-5" }],
        status: "final",
        code: obsCode,
        effectiveDateTime: "2020-06-15T12:30:00+02:00",
      });
      o_inst_late = await createOrFail("Observation", {
        resourceType: "Observation",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-T-6" }],
        status: "final",
        code: obsCode,
        effectiveDateTime: "2020-06-15T23:59:59Z",
      });
      o_next = await createOrFail("Observation", {
        resourceType: "Observation",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-T-7" }],
        status: "final",
        code: obsCode,
        effectiveDateTime: "2020-06-16T00:30:00Z",
      });
      o_y21 = await createOrFail("Observation", {
        resourceType: "Observation",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-T-8" }],
        status: "final",
        code: obsCode,
        effectiveDateTime: "2021",
      });
    });

    afterAll(async () => {
      await cleanup("Observation", [
        o_y20,
        o_ym20_06,
        o_d20,
        o_inst_utc,
        o_inst_tz,
        o_inst_late,
        o_next,
        o_y21,
      ]);
    });

    it("no-prefix year: date=2020 matches every 2020 fixture", async () => {
      const res = await instance.rest.search("Observation", "date=2020");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(
        expect.arrayContaining([
          o_y20,
          o_ym20_06,
          o_d20,
          o_inst_utc,
          o_inst_tz,
          o_inst_late,
          o_next,
        ]),
      );
      expect(ids).not.toContain(o_y21);
    });

    it("explicit eq year: date=eq2020", async () => {
      const res = await instance.rest.search("Observation", "date=eq2020");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(
        expect.arrayContaining([
          o_y20,
          o_ym20_06,
          o_d20,
          o_inst_utc,
          o_inst_tz,
          o_inst_late,
          o_next,
        ]),
      );
      expect(ids).not.toContain(o_y21);
    });

    it("no-prefix month: date=2020-06 narrows to June (June 16 still in June)", async () => {
      const res = await instance.rest.search("Observation", "date=2020-06");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(
        expect.arrayContaining([
          o_ym20_06,
          o_d20,
          o_inst_utc,
          o_inst_tz,
          o_inst_late,
          o_next,
        ]),
      );
      expect(ids).not.toContain(o_y20);
      expect(ids).not.toContain(o_y21);
    });

    it("explicit eq month: date=eq2020-06", async () => {
      const res = await instance.rest.search("Observation", "date=eq2020-06");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(
        expect.arrayContaining([
          o_ym20_06,
          o_d20,
          o_inst_utc,
          o_inst_tz,
          o_inst_late,
          o_next,
        ]),
      );
      expect(ids).not.toContain(o_y20);
      expect(ids).not.toContain(o_y21);
    });

    it("no-prefix day: date=2020-06-15 matches day + within-day instants only", async () => {
      const res = await instance.rest.search("Observation", "date=2020-06-15");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(
        expect.arrayContaining([o_d20, o_inst_utc, o_inst_tz, o_inst_late]),
      );
      expect(ids).not.toContain(o_y20);
      expect(ids).not.toContain(o_ym20_06);
      expect(ids).not.toContain(o_next);
      expect(ids).not.toContain(o_y21);
    });

    it("explicit eq day: date=eq2020-06-15", async () => {
      const res = await instance.rest.search("Observation", "date=eq2020-06-15");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(
        expect.arrayContaining([o_d20, o_inst_utc, o_inst_tz, o_inst_late]),
      );
      expect(ids).not.toContain(o_y20);
      expect(ids).not.toContain(o_ym20_06);
      expect(ids).not.toContain(o_next);
      expect(ids).not.toContain(o_y21);
    });

    it("no-prefix full instant: TZ-normalized variants both match", async () => {
      const res = await instance.rest.search(
        "Observation",
        `date=${encodeURIComponent("2020-06-15T10:30:00Z")}`,
      );
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([o_inst_utc, o_inst_tz]));
      expect(ids).not.toContain(o_y20);
      expect(ids).not.toContain(o_ym20_06);
      expect(ids).not.toContain(o_d20);
      expect(ids).not.toContain(o_inst_late);
      expect(ids).not.toContain(o_next);
      expect(ids).not.toContain(o_y21);
    });

    it("explicit eq full instant: date=eq2020-06-15T10:30:00Z", async () => {
      const res = await instance.rest.search(
        "Observation",
        `date=eq${encodeURIComponent("2020-06-15T10:30:00Z")}`,
      );
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([o_inst_utc, o_inst_tz]));
      expect(ids).not.toContain(o_y20);
      expect(ids).not.toContain(o_ym20_06);
      expect(ids).not.toContain(o_d20);
      expect(ids).not.toContain(o_inst_late);
      expect(ids).not.toContain(o_next);
      expect(ids).not.toContain(o_y21);
    });

    it("ne full instant: excludes equal pair, keeps everything else", async () => {
      const res = await instance.rest.search(
        "Observation",
        `date=ne${encodeURIComponent("2020-06-15T10:30:00Z")}`,
      );
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(
        expect.arrayContaining([o_y20, o_ym20_06, o_d20, o_inst_late, o_next, o_y21]),
      );
      expect(ids).not.toContain(o_inst_utc);
      expect(ids).not.toContain(o_inst_tz);
    });

    it("gt full instant: coarse-precision uppers extend past param upper", async () => {
      const res = await instance.rest.search(
        "Observation",
        `date=gt${encodeURIComponent("2020-06-15T10:30:00Z")}`,
      );
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(
        expect.arrayContaining([o_y20, o_ym20_06, o_d20, o_inst_late, o_next, o_y21]),
      );
      expect(ids).not.toContain(o_inst_utc);
      expect(ids).not.toContain(o_inst_tz);
    });

    it("gt day: coarse-precision resources extend past 2020-06-16", async () => {
      const res = await instance.rest.search("Observation", "date=gt2020-06-15");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([o_y20, o_ym20_06, o_next, o_y21]));
      expect(ids).not.toContain(o_d20);
      expect(ids).not.toContain(o_inst_utc);
      expect(ids).not.toContain(o_inst_tz);
      expect(ids).not.toContain(o_inst_late);
    });

    it("gt year: date=gt2020 matches only 2021 and beyond", async () => {
      const res = await instance.rest.search("Observation", "date=gt2020");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(o_y21);
      expect(ids).not.toContain(o_y20);
      expect(ids).not.toContain(o_ym20_06);
      expect(ids).not.toContain(o_d20);
      expect(ids).not.toContain(o_inst_utc);
      expect(ids).not.toContain(o_inst_tz);
      expect(ids).not.toContain(o_inst_late);
      expect(ids).not.toContain(o_next);
    });

    it("ge year: date=ge2020 includes every 2020 fixture and beyond", async () => {
      const res = await instance.rest.search("Observation", "date=ge2020");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(
        expect.arrayContaining([
          o_y20,
          o_ym20_06,
          o_d20,
          o_inst_utc,
          o_inst_tz,
          o_inst_late,
          o_next,
          o_y21,
        ]),
      );
    });

    it("lt full instant: coarse-precision lowers precede param lower", async () => {
      const res = await instance.rest.search(
        "Observation",
        `date=lt${encodeURIComponent("2020-06-15T10:30:00Z")}`,
      );
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([o_y20, o_ym20_06, o_d20]));
      expect(ids).not.toContain(o_inst_utc);
      expect(ids).not.toContain(o_inst_tz);
      expect(ids).not.toContain(o_inst_late);
      expect(ids).not.toContain(o_next);
      expect(ids).not.toContain(o_y21);
    });

    it("le year: date=le2020 includes every 2020 fixture, excludes 2021", async () => {
      const res = await instance.rest.search("Observation", "date=le2020");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(
        expect.arrayContaining([
          o_y20,
          o_ym20_06,
          o_d20,
          o_inst_utc,
          o_inst_tz,
          o_inst_late,
          o_next,
        ]),
      );
      expect(ids).not.toContain(o_y21);
    });
  });

  describe("Period closed — Encounter.period", () => {
    const encClass = {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "AMB",
    };
    let e_dd_90: string;
    let e_yy_90: string;
    let e_ym_90: string;
    let e_dm_90: string;
    let e_dy_long: string;
    let e_dd_jun15: string;
    let e_1980: string;
    let e_2000: string;
    let e_straddle: string;

    beforeAll(async () => {
      e_dd_90 = await createOrFail("Encounter", {
        resourceType: "Encounter",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-PC-1" }],
        status: "finished",
        class: encClass,
        period: { start: "1990-01-01", end: "1990-12-31" },
      });
      e_yy_90 = await createOrFail("Encounter", {
        resourceType: "Encounter",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-PC-2" }],
        status: "finished",
        class: encClass,
        period: { start: "1990", end: "1990" },
      });
      e_ym_90 = await createOrFail("Encounter", {
        resourceType: "Encounter",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-PC-3" }],
        status: "finished",
        class: encClass,
        period: { start: "1990", end: "1990-06" },
      });
      e_dm_90 = await createOrFail("Encounter", {
        resourceType: "Encounter",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-PC-4" }],
        status: "finished",
        class: encClass,
        period: { start: "1990-03-15", end: "1990-06" },
      });
      e_dy_long = await createOrFail("Encounter", {
        resourceType: "Encounter",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-PC-5" }],
        status: "finished",
        class: encClass,
        period: { start: "1990-06-15", end: "1995" },
      });
      e_dd_jun15 = await createOrFail("Encounter", {
        resourceType: "Encounter",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-PC-6" }],
        status: "finished",
        class: encClass,
        period: { start: "1990-06-15", end: "1990-06-15" },
      });
      e_1980 = await createOrFail("Encounter", {
        resourceType: "Encounter",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-PC-7" }],
        status: "finished",
        class: encClass,
        period: { start: "1980-01-01", end: "1980-12-31" },
      });
      e_2000 = await createOrFail("Encounter", {
        resourceType: "Encounter",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-PC-8" }],
        status: "finished",
        class: encClass,
        period: { start: "2000-01-01", end: "2000-12-31" },
      });
      e_straddle = await createOrFail("Encounter", {
        resourceType: "Encounter",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-PC-9" }],
        status: "finished",
        class: encClass,
        period: { start: "1990-06-01", end: "1992-06-01" },
      });
    });

    afterAll(async () => {
      await cleanup("Encounter", [
        e_dd_90,
        e_yy_90,
        e_ym_90,
        e_dm_90,
        e_dy_long,
        e_dd_jun15,
        e_1980,
        e_2000,
        e_straddle,
      ]);
    });

    it("no-prefix year: date=1990 matches Periods contained in 1990", async () => {
      const res = await instance.rest.search("Encounter", "date=1990");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(
        expect.arrayContaining([e_dd_90, e_yy_90, e_ym_90, e_dm_90, e_dd_jun15]),
      );
      expect(ids).not.toContain(e_dy_long);
      expect(ids).not.toContain(e_1980);
      expect(ids).not.toContain(e_2000);
      expect(ids).not.toContain(e_straddle);
    });

    it("explicit eq year: date=eq1990", async () => {
      const res = await instance.rest.search("Encounter", "date=eq1990");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(
        expect.arrayContaining([e_dd_90, e_yy_90, e_ym_90, e_dm_90, e_dd_jun15]),
      );
      expect(ids).not.toContain(e_dy_long);
      expect(ids).not.toContain(e_1980);
      expect(ids).not.toContain(e_2000);
      expect(ids).not.toContain(e_straddle);
    });

    it("no-prefix month: date=1990-06 only matches the single June day Period", async () => {
      const res = await instance.rest.search("Encounter", "date=1990-06");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(e_dd_jun15);
      expect(ids).not.toContain(e_dd_90);
      expect(ids).not.toContain(e_yy_90);
      expect(ids).not.toContain(e_ym_90);
      expect(ids).not.toContain(e_dm_90);
      expect(ids).not.toContain(e_dy_long);
      expect(ids).not.toContain(e_1980);
      expect(ids).not.toContain(e_2000);
      expect(ids).not.toContain(e_straddle);
    });

    it("explicit eq month: date=eq1990-06", async () => {
      const res = await instance.rest.search("Encounter", "date=eq1990-06");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(e_dd_jun15);
      expect(ids).not.toContain(e_dd_90);
      expect(ids).not.toContain(e_yy_90);
      expect(ids).not.toContain(e_ym_90);
      expect(ids).not.toContain(e_dm_90);
      expect(ids).not.toContain(e_dy_long);
      expect(ids).not.toContain(e_1980);
      expect(ids).not.toContain(e_2000);
      expect(ids).not.toContain(e_straddle);
    });

    it("no-prefix day: date=1990-06-15", async () => {
      const res = await instance.rest.search("Encounter", "date=1990-06-15");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(e_dd_jun15);
      expect(ids).not.toContain(e_dd_90);
      expect(ids).not.toContain(e_yy_90);
      expect(ids).not.toContain(e_ym_90);
      expect(ids).not.toContain(e_dm_90);
      expect(ids).not.toContain(e_dy_long);
      expect(ids).not.toContain(e_1980);
      expect(ids).not.toContain(e_2000);
      expect(ids).not.toContain(e_straddle);
    });

    it("explicit eq day: date=eq1990-06-15", async () => {
      const res = await instance.rest.search("Encounter", "date=eq1990-06-15");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(e_dd_jun15);
      expect(ids).not.toContain(e_dd_90);
      expect(ids).not.toContain(e_yy_90);
      expect(ids).not.toContain(e_ym_90);
      expect(ids).not.toContain(e_dm_90);
      expect(ids).not.toContain(e_dy_long);
      expect(ids).not.toContain(e_1980);
      expect(ids).not.toContain(e_2000);
      expect(ids).not.toContain(e_straddle);
    });

    it("ne year: date=ne1990 excludes Periods fully in 1990", async () => {
      const res = await instance.rest.search("Encounter", "date=ne1990");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(
        expect.arrayContaining([e_dy_long, e_1980, e_2000, e_straddle]),
      );
      expect(ids).not.toContain(e_dd_90);
      expect(ids).not.toContain(e_yy_90);
      expect(ids).not.toContain(e_ym_90);
      expect(ids).not.toContain(e_dm_90);
      expect(ids).not.toContain(e_dd_jun15);
    });

    it("gt year: date=gt1990 requires upper > 1991-01-01", async () => {
      const res = await instance.rest.search("Encounter", "date=gt1990");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([e_2000, e_straddle, e_dy_long]));
      expect(ids).not.toContain(e_dd_90);
      expect(ids).not.toContain(e_yy_90);
      expect(ids).not.toContain(e_ym_90);
      expect(ids).not.toContain(e_dm_90);
      expect(ids).not.toContain(e_dd_jun15);
      expect(ids).not.toContain(e_1980);
    });

    it("gt month: date=gt1990-06 requires upper > 1990-07-01", async () => {
      const res = await instance.rest.search("Encounter", "date=gt1990-06");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(
        expect.arrayContaining([e_2000, e_straddle, e_dy_long, e_dd_90, e_yy_90]),
      );
      expect(ids).not.toContain(e_ym_90);
      expect(ids).not.toContain(e_dm_90);
      expect(ids).not.toContain(e_dd_jun15);
      expect(ids).not.toContain(e_1980);
    });

    it("sa year: date=sa1990 — only Periods whose lower > 1991-01-01", async () => {
      const res = await instance.rest.search("Encounter", "date=sa1990");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(e_2000);
      expect(ids).not.toContain(e_dd_90);
      expect(ids).not.toContain(e_yy_90);
      expect(ids).not.toContain(e_ym_90);
      expect(ids).not.toContain(e_dm_90);
      expect(ids).not.toContain(e_dy_long);
      expect(ids).not.toContain(e_dd_jun15);
      expect(ids).not.toContain(e_straddle);
      expect(ids).not.toContain(e_1980);
    });

    it("eb year: date=eb1990 — only Periods whose upper < 1990-01-01", async () => {
      const res = await instance.rest.search("Encounter", "date=eb1990");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(e_1980);
      expect(ids).not.toContain(e_dd_90);
      expect(ids).not.toContain(e_yy_90);
      expect(ids).not.toContain(e_ym_90);
      expect(ids).not.toContain(e_dm_90);
      expect(ids).not.toContain(e_dy_long);
      expect(ids).not.toContain(e_dd_jun15);
      expect(ids).not.toContain(e_straddle);
      expect(ids).not.toContain(e_2000);
    });

    it("ge year: date=ge1990 includes 1990 cluster + later", async () => {
      const res = await instance.rest.search("Encounter", "date=ge1990");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(
        expect.arrayContaining([
          e_dd_90,
          e_yy_90,
          e_ym_90,
          e_dm_90,
          e_dd_jun15,
          e_dy_long,
          e_straddle,
          e_2000,
        ]),
      );
      expect(ids).not.toContain(e_1980);
    });

    it("lt year: date=lt1990 only earlier-than-1990 Periods", async () => {
      const res = await instance.rest.search("Encounter", "date=lt1990");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(e_1980);
      expect(ids).not.toContain(e_dd_90);
      expect(ids).not.toContain(e_yy_90);
      expect(ids).not.toContain(e_ym_90);
      expect(ids).not.toContain(e_dm_90);
      expect(ids).not.toContain(e_dy_long);
      expect(ids).not.toContain(e_dd_jun15);
      expect(ids).not.toContain(e_straddle);
      expect(ids).not.toContain(e_2000);
    });

    it("le year: date=le1990 includes 1990 cluster + 1980", async () => {
      const res = await instance.rest.search("Encounter", "date=le1990");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(
        expect.arrayContaining([
          e_dd_90,
          e_yy_90,
          e_ym_90,
          e_dm_90,
          e_dd_jun15,
          e_1980,
        ]),
      );
      expect(ids).not.toContain(e_dy_long);
      expect(ids).not.toContain(e_straddle);
      expect(ids).not.toContain(e_2000);
    });
  });

  describe("Period open-ended — Encounter.period", () => {
    const encClass = {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "AMB",
    };
    let e_oh_d10: string;
    let e_oh_y10: string;
    let e_oh_ym10: string;
    let e_ol_d85: string;
    let e_ol_y85: string;

    beforeAll(async () => {
      e_oh_d10 = await createOrFail("Encounter", {
        resourceType: "Encounter",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-PO-1" }],
        status: "in-progress",
        class: encClass,
        period: { start: "2010-01-01" },
      });
      e_oh_y10 = await createOrFail("Encounter", {
        resourceType: "Encounter",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-PO-2" }],
        status: "in-progress",
        class: encClass,
        period: { start: "2010" },
      });
      e_oh_ym10 = await createOrFail("Encounter", {
        resourceType: "Encounter",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-PO-3" }],
        status: "in-progress",
        class: encClass,
        period: { start: "2010-06" },
      });
      e_ol_d85 = await createOrFail("Encounter", {
        resourceType: "Encounter",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-PO-4" }],
        status: "finished",
        class: encClass,
        period: { end: "1985-12-31" },
      });
      e_ol_y85 = await createOrFail("Encounter", {
        resourceType: "Encounter",
        identifier: [{ system: IDENT_SYSTEM, value: "DT-PO-5" }],
        status: "finished",
        class: encClass,
        period: { end: "1985" },
      });
    });

    afterAll(async () => {
      await cleanup("Encounter", [
        e_oh_d10,
        e_oh_y10,
        e_oh_ym10,
        e_ol_d85,
        e_ol_y85,
      ]);
    });

    it("gt year before open-high starts: date=gt1995 matches every open-high", async () => {
      const res = await instance.rest.search("Encounter", "date=gt1995");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(
        expect.arrayContaining([e_oh_d10, e_oh_y10, e_oh_ym10]),
      );
      expect(ids).not.toContain(e_ol_d85);
      expect(ids).not.toContain(e_ol_y85);
    });

    it("gt year past open-high starts: date=gt2015 still matches (upper is +∞)", async () => {
      const res = await instance.rest.search("Encounter", "date=gt2015");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(
        expect.arrayContaining([e_oh_d10, e_oh_y10, e_oh_ym10]),
      );
      expect(ids).not.toContain(e_ol_d85);
      expect(ids).not.toContain(e_ol_y85);
    });

    it("gt day mid-2010: boundary against year-precision start", async () => {
      const res = await instance.rest.search("Encounter", "date=gt2010-06-15");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(
        expect.arrayContaining([e_oh_d10, e_oh_y10, e_oh_ym10]),
      );
      expect(ids).not.toContain(e_ol_d85);
      expect(ids).not.toContain(e_ol_y85);
    });

    it("eb does NOT match any open-high (no upper bound)", async () => {
      const res = await instance.rest.search("Encounter", "date=eb2015");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).not.toContain(e_oh_d10);
      expect(ids).not.toContain(e_oh_y10);
      expect(ids).not.toContain(e_oh_ym10);
    });

    it("lt year past open-low ends: date=lt2000 matches every open-low", async () => {
      const res = await instance.rest.search("Encounter", "date=lt2000");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([e_ol_d85, e_ol_y85]));
      expect(ids).not.toContain(e_oh_d10);
      expect(ids).not.toContain(e_oh_y10);
      expect(ids).not.toContain(e_oh_ym10);
    });

    it("sa does NOT match any open-low (no lower bound)", async () => {
      const res = await instance.rest.search("Encounter", "date=sa1900");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).not.toContain(e_ol_d85);
      expect(ids).not.toContain(e_ol_y85);
    });

    it("sa against open-high: matches when param.upper < resource.lower", async () => {
      const res = await instance.rest.search("Encounter", "date=sa1990");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([e_oh_d10, e_oh_y10, e_oh_ym10]));
      expect(ids).not.toContain(e_ol_d85);
      expect(ids).not.toContain(e_ol_y85);
    });

    it("sa against open-high: does NOT match when param.upper >= resource.lower", async () => {
      const res = await instance.rest.search("Encounter", "date=sa2010");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).not.toContain(e_oh_d10);
      expect(ids).not.toContain(e_oh_y10);
      expect(ids).not.toContain(e_oh_ym10);
    });

    it("no-prefix eq excludes every open-ended Period (two separate searches)", async () => {
      const resHigh = await instance.rest.search("Encounter", "date=2010");
      expect(resHigh).toHaveStatus(200);
      const idsHigh = idsOf(resHigh.body);
      expect(idsHigh).not.toContain(e_oh_d10);
      expect(idsHigh).not.toContain(e_oh_y10);
      expect(idsHigh).not.toContain(e_oh_ym10);

      const resLow = await instance.rest.search("Encounter", "date=1985");
      expect(resLow).toHaveStatus(200);
      const idsLow = idsOf(resLow.body);
      expect(idsLow).not.toContain(e_ol_d85);
      expect(idsLow).not.toContain(e_ol_y85);
    });
  });
});
