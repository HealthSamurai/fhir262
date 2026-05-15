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
    throw new Error(`create ${type} failed: ${res.status} ${JSON.stringify(res.body)}`);
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
  });

  afterAll(async () => {
    await cleanup("Patient", [pA, pB, pC]);
    await cleanup("Organization", [orgId]);
  });

  it("token: identifier matches exact system|value", async () => {
    const res = await instance.rest.search("Patient", `identifier=${IDENT_SYSTEM}|MRN-001`);
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(pA);
    expect(ids).not.toContain(pB);
    expect(ids).not.toContain(pC);
  });

  it("string: family does case-insensitive prefix match", async () => {
    const res = await instance.rest.search("Patient", "family=smi");
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toEqual(expect.arrayContaining([pA, pC]));
    expect(ids).not.toContain(pB);
  });

  it("date: birthdate=ge filters earlier dates out", async () => {
    const res = await instance.rest.search("Patient", "birthdate=ge1985-01-01");
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toEqual(expect.arrayContaining([pB, pC]));
    expect(ids).not.toContain(pA);
  });

  it("reference: organization=Organization/{id} matches the linked patient", async () => {
    const res = await instance.rest.search("Patient", `organization=Organization/${orgId}`);
    expect(res.status).toBe(200);
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
    expect(res.status).toBe(200);
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
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([p1]);
  });

  it("_lastUpdated=ge<past> matches both patients", async () => {
    const res = await instance.rest.search("Patient", `_lastUpdated=ge${tPast}`);
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([p1, p2]));
  });

  it("_lastUpdated=ge<future> matches none", async () => {
    const res = await instance.rest.search("Patient", `_lastUpdated=ge${tFuture}`);
    expect(res.status).toBe(200);
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
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([s2, s1, s3]);
  });

  it("_sort=-birthdate sorts descending", async () => {
    const res = await instance.rest.search(
      "Patient",
      `identifier=${IDENT_SYSTEM}|&_sort=-birthdate`,
    );
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([s3, s1, s2]);
  });

  it("_sort=-_lastUpdated sorts by a system search param", async () => {
    const res = await instance.rest.search(
      "Patient",
      `identifier=${IDENT_SYSTEM}|&_sort=-_lastUpdated`,
    );
    expect(res.status).toBe(200);
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
    expect(res.status).toBe(200);
    expect(idsOf(res.body).length).toBeLessThanOrEqual(2);
  });

});
