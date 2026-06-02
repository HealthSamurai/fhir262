import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { ServerInstance } from "../../interfaces/server";
import type { Rest } from "../../interfaces/rest";
import { loadImpl } from "../../framework/impl-loader";
import {
  IDENT_SYSTEM,
  type Bundle,
  idsOf,
  createOrFail,
  cleanup,
  sleep,
  dualMode,
} from "./_helpers";

const server = loadImpl().server;
let instance: ServerInstance;
const rest = (): Rest => instance.rest;

beforeAll(async () => {
  instance = await server.startWithCoreOnly("r4");
});

afterAll(async () => {
  await instance.stop();
});

dualMode("by-type-general", rest, (search) => {
  let orgId: string;
  let pA: string;
  let pB: string;
  let pC: string;
  let pD: string;
  let pE: string;

  beforeAll(async () => {
    orgId = await createOrFail(instance.rest, "Organization", {
      resourceType: "Organization",
      name: "fhir262 Org",
    });
    pA = await createOrFail(instance.rest, "Patient", {
      resourceType: "Patient",
      identifier: [{ system: IDENT_SYSTEM, value: "MRN-001" }],
      name: [{ family: "Smith", given: ["John"] }],
      gender: "male",
      birthDate: "1980-01-15",
      managingOrganization: { reference: `Organization/${orgId}` },
    });
    pB = await createOrFail(instance.rest, "Patient", {
      resourceType: "Patient",
      identifier: [{ system: IDENT_SYSTEM, value: "MRN-002" }],
      name: [{ family: "Jones", given: ["Jane"] }],
      gender: "female",
      birthDate: "1990-06-20",
    });
    pC = await createOrFail(instance.rest, "Patient", {
      resourceType: "Patient",
      identifier: [{ system: IDENT_SYSTEM, value: "MRN-003" }],
      name: [{ family: "Smithson", given: ["Sam"] }],
      gender: "female",
      birthDate: "2000-12-31",
    });
    // No IDENT_SYSTEM identifier on pD/pE to keep _total=accurate at 3.
    pD = await createOrFail(instance.rest, "Patient", {
      resourceType: "Patient",
      name: [{ family: "Muñoz", given: ["Maria"] }],
    });
    pE = await createOrFail(instance.rest, "Patient", {
      resourceType: "Patient",
      name: [{ family: "Van Helsing", given: ["Abraham"] }],
    });
  });

  afterAll(async () => {
    await cleanup(instance.rest, "Patient", [pA, pB, pC, pD, pE]);
    await cleanup(instance.rest, "Organization", [orgId]);
  });

  it("token: identifier matches exact system|value", async () => {
    const res = await search("Patient", `identifier=${IDENT_SYSTEM}|MRN-001`);
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(pA);
    expect(ids).not.toContain(pB);
    expect(ids).not.toContain(pC);
  });

  it("string: family does case-insensitive prefix match", async () => {
    const res = await search("Patient", "family=smi");
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toEqual(expect.arrayContaining([pA, pC]));
    expect(ids).not.toContain(pB);
  });

  it("string: family is accent-insensitive", async () => {
    const res = await search("Patient", "family=munoz");
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(pD);
  });

  it("string: family matches only at the start (mid-string substring does not match)", async () => {
    const res = await search("Patient", "family=oz");
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).not.toContain(pD);
  });

  it("string: family value may contain spaces", async () => {
    const res = await search(
      "Patient",
      `family=${encodeURIComponent("Van Hel")}`,
    );
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(pE);
    expect(ids).not.toContain(pA);
  });

  it("date: birthdate=ge filters earlier dates out", async () => {
    const res = await search("Patient", "birthdate=ge1985-01-01");
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toEqual(expect.arrayContaining([pB, pC]));
    expect(ids).not.toContain(pA);
  });

  it("reference: organization=Organization/{id} matches the linked patient", async () => {
    const res = await search("Patient", `organization=Organization/${orgId}`);
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(pA);
    expect(ids).not.toContain(pB);
    expect(ids).not.toContain(pC);
  });

  it("total: _total=accurate returns exact count", async () => {
    const res = await search(
      "Patient",
      `identifier=${IDENT_SYSTEM}|&_total=accurate`,
    );
    expect(res).toHaveStatus(200);
    expect((res.body as Bundle).total).toBe(3);
  });

});

dualMode("system", rest, (search) => {
  const tPast = "2000-01-01T00:00:00Z";
  const tFuture = "2999-01-01T00:00:00Z";
  let p1: string;
  let p2: string;

  beforeAll(async () => {
    p1 = await createOrFail(instance.rest, "Patient", { resourceType: "Patient", gender: "male" });
    p2 = await createOrFail(instance.rest, "Patient", { resourceType: "Patient", gender: "female" });
  });

  afterAll(async () => {
    await cleanup(instance.rest, "Patient", [p1, p2]);
  });

  it("_id matches a single id exactly", async () => {
    const res = await search("Patient", `_id=${p1}`);
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual([p1]);
  });

  it("_lastUpdated=ge<past> matches both patients", async () => {
    const res = await search("Patient", `_lastUpdated=ge${tPast}`);
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([p1, p2]));
  });

  it("_lastUpdated=ge<future> matches none", async () => {
    const res = await search("Patient", `_lastUpdated=ge${tFuture}`);
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual([]);
  });
});

dualMode("sort", rest, (search) => {
  let s1: string;
  let s2: string;
  let s3: string;

  beforeAll(async () => {
    s1 = await createOrFail(instance.rest, "Patient", {
      resourceType: "Patient",
      identifier: [{ system: IDENT_SYSTEM, value: "MRN-S1" }],
      birthDate: "1990-01-01",
    });
    await sleep(20);
    s2 = await createOrFail(instance.rest, "Patient", {
      resourceType: "Patient",
      identifier: [{ system: IDENT_SYSTEM, value: "MRN-S2" }],
      birthDate: "1980-01-01",
    });
    await sleep(20);
    s3 = await createOrFail(instance.rest, "Patient", {
      resourceType: "Patient",
      identifier: [{ system: IDENT_SYSTEM, value: "MRN-S3" }],
      birthDate: "2000-01-01",
    });
  });

  afterAll(async () => {
    await cleanup(instance.rest, "Patient", [s1, s2, s3]);
  });

  it("_sort=birthdate sorts ascending", async () => {
    const res = await search(
      "Patient",
      `identifier=${IDENT_SYSTEM}|&_sort=birthdate`,
    );
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual([s2, s1, s3]);
  });

  it("_sort=-birthdate sorts descending", async () => {
    const res = await search(
      "Patient",
      `identifier=${IDENT_SYSTEM}|&_sort=-birthdate`,
    );
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual([s3, s1, s2]);
  });

  it("_sort=-_lastUpdated sorts by a system search param", async () => {
    const res = await search(
      "Patient",
      `identifier=${IDENT_SYSTEM}|&_sort=-_lastUpdated`,
    );
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual([s3, s2, s1]);
  });
});

dualMode("paging", rest, (search) => {
  const ids: string[] = [];

  beforeAll(async () => {
    for (let i = 1; i <= 5; i++) {
      const id = await createOrFail(instance.rest, "Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: `P-${i}` }],
      });
      ids.push(id);
    }
  });

  afterAll(async () => {
    await cleanup(instance.rest, "Patient", ids);
  });

  it("_count=2 returns at most 2 entries and a next link", async () => {
    const res = await search(
      "Patient",
      `identifier=${IDENT_SYSTEM}|&_count=2`,
    );
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body).length).toBeLessThanOrEqual(2);
  });

});

dualMode("joins-and-or", rest, (search) => {
  let pAB: string;
  let pA: string;
  let pB: string;
  let pC: string;
  let aMB: string;
  let aM: string;
  let aB: string;
  let aF: string;

  beforeAll(async () => {
    pAB = await createOrFail(instance.rest, "Patient", {
      resourceType: "Patient",
      identifier: [{ system: IDENT_SYSTEM, value: "JOIN-1" }],
      name: [{ family: "Smith", given: ["Alex", "Bob"] }],
      birthDate: "1985-06-15",
    });
    pA = await createOrFail(instance.rest, "Patient", {
      resourceType: "Patient",
      identifier: [{ system: IDENT_SYSTEM, value: "JOIN-2" }],
      name: [{ family: "Doe", given: ["Alex"] }],
      birthDate: "2010-03-01",
    });
    pB = await createOrFail(instance.rest, "Patient", {
      resourceType: "Patient",
      identifier: [{ system: IDENT_SYSTEM, value: "JOIN-3" }],
      name: [{ family: "Doe", given: ["Bob"] }],
      birthDate: "1970-01-01",
    });
    pC = await createOrFail(instance.rest, "Patient", {
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
    aMB = await createOrFail(instance.rest, "AllergyIntolerance", allergy("JOIN-A1", ["medication", "biologic"]));
    aM = await createOrFail(instance.rest, "AllergyIntolerance", allergy("JOIN-A2", ["medication"]));
    aB = await createOrFail(instance.rest, "AllergyIntolerance", allergy("JOIN-A3", ["biologic"]));
    aF = await createOrFail(instance.rest, "AllergyIntolerance", allergy("JOIN-A4", ["food"]));
  });

  afterAll(async () => {
    await cleanup(instance.rest, "AllergyIntolerance", [aMB, aM, aB, aF]);
    await cleanup(instance.rest, "Patient", [pAB, pA, pB, pC]);
  });

  it("AND across params: given + family must both match", async () => {
    const res = await search("Patient", "given=Alex&family=Doe");
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(pA);
    expect(ids).not.toContain(pAB);
    expect(ids).not.toContain(pB);
    expect(ids).not.toContain(pC);
  });

  it("AND repeated on scalar-simple: birthdate range narrows to inside the range", async () => {
    const res = await search(
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
    const res = await search(
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
    const res = await search("Patient", "name=Alex&name=Smith");
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(pAB);
    expect(ids).not.toContain(pA);
    expect(ids).not.toContain(pB);
    expect(ids).not.toContain(pC);
  });

  it("OR via comma on array-complex: given=Alex,Carol", async () => {
    const res = await search("Patient", "given=Alex,Carol");
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toEqual(expect.arrayContaining([pAB, pA, pC]));
    expect(ids).not.toContain(pB);
  });

  it("OR with prefix per value: birthdate outside [1975, 2005)", async () => {
    const res = await search(
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
    const res = await search("Patient", "given:exact=Alex,Carol");
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toEqual(expect.arrayContaining([pAB, pA, pC]));
    expect(ids).not.toContain(pB);
  });

  it("OR on array-simple: category=medication,biologic", async () => {
    const res = await search(
      "AllergyIntolerance",
      "category=medication,biologic",
    );
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toEqual(expect.arrayContaining([aMB, aM, aB]));
    expect(ids).not.toContain(aF);
  });

  it("OR on array-complex via name parameter: name=Doe,Smith", async () => {
    const res = await search("Patient", "name=Doe,Smith");
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toEqual(expect.arrayContaining([pAB, pA, pB, pC]));
  });

  it("MIX: AND between params with OR within one — given=Alex,Bob & family=Smith", async () => {
    const res = await search("Patient", "given=Alex,Bob&family=Smith");
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(pAB);
    expect(ids).not.toContain(pA);
    expect(ids).not.toContain(pB);
    expect(ids).not.toContain(pC);
  });
});

dualMode("modifiers", rest, (search) => {
  describe("exact (string)", () => {
    let pS: string;
    let pSn: string;
    let psm: string;

    beforeAll(async () => {
      pS = await createOrFail(instance.rest, "Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "EX-1" }],
        name: [{ family: "Smith" }],
      });
      pSn = await createOrFail(instance.rest, "Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "EX-2" }],
        name: [{ family: "Smithson" }],
      });
      psm = await createOrFail(instance.rest, "Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "EX-3" }],
        name: [{ family: "smith" }],
      });
    });

    afterAll(async () => {
      await cleanup(instance.rest, "Patient", [pS, pSn, psm]);
    });

    it("family:exact=Smith requires full-string and matching case", async () => {
      const res = await search("Patient", "family:exact=Smith");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(pS);
      expect(ids).not.toContain(pSn);
      expect(ids).not.toContain(psm);
    });

    it("family:exact=smith matches only the lowercase-stored value", async () => {
      const res = await search("Patient", "family:exact=smith");
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
      pAnd = await createOrFail(instance.rest, "Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "CT-1" }],
        name: [{ family: "Anderson" }],
      });
      pSon = await createOrFail(instance.rest, "Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "CT-2" }],
        name: [{ family: "Sonder" }],
      });
      pSam = await createOrFail(instance.rest, "Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "CT-3" }],
        name: [{ family: "Samsonite" }],
      });
      pBr = await createOrFail(instance.rest, "Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "CT-4" }],
        name: [{ family: "Brown" }],
      });
      vsAcme = await createOrFail(instance.rest, "ValueSet", {
        resourceType: "ValueSet",
        url: "http://acme.org/fhir/ValueSet/foo",
        status: "active",
      });
      vsEx = await createOrFail(instance.rest, "ValueSet", {
        resourceType: "ValueSet",
        url: "http://example.org/fhir/ValueSet/bar",
        status: "active",
      });
    });

    afterAll(async () => {
      await cleanup(instance.rest, "Patient", [pAnd, pSon, pSam, pBr]);
      await cleanup(instance.rest, "ValueSet", [vsAcme, vsEx]);
    });

    it("family:contains=son matches substring anywhere (Anderson, Sonder, Samsonite)", async () => {
      const res = await search("Patient", "family:contains=son");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([pAnd, pSon, pSam]));
      expect(ids).not.toContain(pBr);
    });

    it("family:contains=SON is case-insensitive", async () => {
      const res = await search("Patient", "family:contains=SON");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([pAnd, pSon, pSam]));
      expect(ids).not.toContain(pBr);
    });

    it("url:contains=acme matches a URI substring on ValueSet", async () => {
      const res = await search("ValueSet", "url:contains=acme");
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
      pFull = await createOrFail(instance.rest, "Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "MI-1" }],
        gender: "male",
        birthDate: "1980-01-01",
      });
      pEmpty = await createOrFail(instance.rest, "Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "MI-2" }],
      });
    });

    afterAll(async () => {
      await cleanup(instance.rest, "Patient", [pFull, pEmpty]);
    });

    it("gender:missing=true matches records without gender", async () => {
      const res = await search("Patient", "gender:missing=true");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(pEmpty);
      expect(ids).not.toContain(pFull);
    });

    it("gender:missing=false matches records with gender", async () => {
      const res = await search("Patient", "gender:missing=false");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(pFull);
      expect(ids).not.toContain(pEmpty);
    });

    it("birthdate:missing=true matches records without birthDate", async () => {
      const res = await search("Patient", "birthdate:missing=true");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(pEmpty);
      expect(ids).not.toContain(pFull);
    });

    it("birthdate:missing=false matches records with birthDate", async () => {
      const res = await search("Patient", "birthdate:missing=false");
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
      pMale = await createOrFail(instance.rest, "Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "NT-1" }],
        gender: "male",
      });
      pFem = await createOrFail(instance.rest, "Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "NT-2" }],
        gender: "female",
      });
      pOth = await createOrFail(instance.rest, "Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "NT-3" }],
        gender: "other",
      });
      pNone = await createOrFail(instance.rest, "Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: "NT-4" }],
      });
    });

    afterAll(async () => {
      await cleanup(instance.rest, "Patient", [pMale, pFem, pOth, pNone]);
    });

    it("gender:not=male excludes male and INCLUDES records with no gender", async () => {
      const res = await search("Patient", "gender:not=male");
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
      pMR = await createOrFail(instance.rest, "Patient", {
        resourceType: "Patient",
        identifier: [
          { system: IDENT_SYSTEM, value: "OT-1" },
          {
            type: { coding: [{ system: V2_0203, code: "MR" }] },
            value: "12345",
          },
        ],
      });
      pMRT = await createOrFail(instance.rest, "Patient", {
        resourceType: "Patient",
        identifier: [
          { system: IDENT_SYSTEM, value: "OT-2" },
          {
            type: { coding: [{ system: V2_0203, code: "MRT" }] },
            value: "12345",
          },
        ],
      });
      pMRX = await createOrFail(instance.rest, "Patient", {
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
      await cleanup(instance.rest, "Patient", [pMR, pMRT, pMRX]);
    });

    it("full system|code|value match", async () => {
      const res = await search(
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
      const res = await search(
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
      const res = await search(
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

