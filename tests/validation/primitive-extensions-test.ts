import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { loadImpl } from "../../framework/impl-loader";
import type { ServerInstance } from "../../interfaces/server";

const server = loadImpl().server;
let instance: ServerInstance;

beforeAll(async () => {
  instance = await server.startWithCoreOnly("r4");
});

afterAll(async () => {
  await instance.stop();
});

async function validatePatient(body: object) {
  return instance.rest.operation("Patient", "$validate", {
    resourceType: "Patient",
    ...body,
  });
}

const BIRTH_TIME = "http://hl7.org/fhir/StructureDefinition/patient-birthTime";
const OWN_PREFIX = "http://hl7.org/fhir/StructureDefinition/humanname-own-prefix";

describe("Patient._birthDate with patient-birthTime extension (valueDateTime)", () => {
  it("is valid", async () => {
    const res = await validatePatient({
      birthDate: "1974-12-25",
      _birthDate: {
        extension: [{ url: BIRTH_TIME, valueDateTime: "1974-12-25T14:35:45-05:00" }],
      },
    });
    expect(res).toBeValid();
  });
});

describe("Patient._birthDate with patient-birthTime extension (partial-date valueDateTime)", () => {
  it("is valid", async () => {
    const res = await validatePatient({
      birthDate: "1974-12-25",
      _birthDate: { extension: [{ url: BIRTH_TIME, valueDateTime: "2020" }] },
    });
    expect(res).toBeValid();
  });
});

describe("Patient.name[0]._given paired with given (each element has Element)", () => {
  it("is valid", async () => {
    const res = await validatePatient({
      name: [{ given: ["a"], _given: [{ id: "test" }] }],
    });
    expect(res).toBeValid();
  });
});

describe("Patient.name[0]._given with trailing null (no extension at that element)", () => {
  it("is valid", async () => {
    const res = await validatePatient({
      name: [{ given: ["a"], _given: [{ id: "test" }, null] }],
    });
    expect(res).toBeValid();
  });
});

describe("Patient.name[0]._given all-null array (no extensions at any element)", () => {
  it("is valid", async () => {
    const res = await validatePatient({
      name: [{ given: ["a"], _given: [null, null] }],
    });
    expect(res).toBeValid();
  });
});

describe("Patient.name[0].given null filled by extension at same element", () => {
  it("is valid", async () => {
    const res = await validatePatient({
      name: [
        {
          given: [null, "test"],
          _given: [{ extension: [{ url: BIRTH_TIME, valueDateTime: "2020" }] }, null],
        },
      ],
    });
    expect(res).toBeValid();
  });
});

describe("Patient._unknown (extension for nonexistent field)", () => {
  it("is invalid", async () => {
    const res = await validatePatient({ _unknown: { id: "1" } });
    expect(res).toBeInvalid();
  });
});

describe("Patient._name (extension subpart on a complex/non-primitive field)", () => {
  let res: { status: number; body: unknown };
  beforeAll(async () => {
    res = await validatePatient({ _name: { id: "1" } });
  });
  it("is invalid", () => {
    expect(res).toBeInvalid();
  });
  it("issue points at Patient.name", () => {
    expect(res).toHaveIssueWithExpression("Patient.name");
  });
});

describe('Patient._active = "test" (subpart must be Element object, not primitive)', () => {
  let res: { status: number; body: unknown };
  beforeAll(async () => {
    res = await validatePatient({ _active: "test" });
  });
  it("is invalid", () => {
    expect(res).toBeInvalid();
  });
  it("issue points at Patient.active", () => {
    expect(res).toHaveIssueWithExpression("Patient.active");
  });
});

describe("Patient._active = [{...}] (scalar primitive's subpart must be object, not array)", () => {
  let res: { status: number; body: unknown };
  beforeAll(async () => {
    res = await validatePatient({ _active: [{ id: "test" }] });
  });
  it("is invalid", () => {
    expect(res).toBeInvalid();
  });
  it("issue points at Patient.active", () => {
    expect(res).toHaveIssueWithExpression("Patient.active");
  });
});

describe("Patient.name[0]._given = {...} (repeated primitive's subpart must be array, not object)", () => {
  let res: { status: number; body: unknown };
  beforeAll(async () => {
    res = await validatePatient({ name: [{ given: ["a"], _given: { id: "test" } }] });
  });
  it("is invalid", () => {
    expect(res).toBeInvalid();
  });
  it("issue points at Patient.name[0].given", () => {
    expect(res).toHaveIssueWithExpression("Patient.name[0].given");
  });
});

describe("Patient.name[0]._given[0].foo (unknown key in Element)", () => {
  it("is invalid", async () => {
    const res = await validatePatient({
      name: [{ given: ["a"], _given: [{ foo: "test" }] }],
    });
    expect(res).toBeInvalid();
  });
});

describe("Patient.name[0]._given[0] extension with wrong-type value (humanname-own-prefix expects valueString)", () => {
  it("is invalid", async () => {
    const res = await validatePatient({
      name: [
        {
          given: ["a"],
          _given: [{ extension: [{ url: OWN_PREFIX, valueCode: "code" }] }],
        },
      ],
    });
    expect(res).toBeInvalid();
  });
});

describe("Patient.name[0].given null without an extension fill (empty-value)", () => {
  let res: { status: number; body: unknown };
  beforeAll(async () => {
    res = await validatePatient({
      name: [{ given: [null, "test"], _given: [{ id: "test" }, null] }],
    });
  });
  it("is invalid", () => {
    expect(res).toBeInvalid();
  });
  it("issue points at Patient.name[0].given[0]", () => {
    expect(res).toHaveIssueWithExpression("Patient.name[0].given[0]");
  });
});
