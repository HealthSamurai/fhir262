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
