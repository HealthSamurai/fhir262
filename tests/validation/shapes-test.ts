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

describe("Patient.active = object (primitive element, object value)", () => {
  let res: { status: number; body: unknown };
  beforeAll(async () => {
    res = await validatePatient({ active: { id: "1" } });
  });
  it("is invalid", () => {
    expect(res).toBeInvalid();
  });
  it("issue points at Patient.active", () => {
    expect(res).toHaveIssueWithExpression("Patient.active");
  });
});

describe("Patient.name[0].given[0] = object (primitive-string item, object value)", () => {
  let res: { status: number; body: unknown };
  beforeAll(async () => {
    res = await validatePatient({ name: [{ given: [{ id: "1" }] }] });
  });
  it("is invalid", () => {
    expect(res).toBeInvalid();
  });
  it("issue points at Patient.name[0].given[0]", () => {
    expect(res).toHaveIssueWithExpression("Patient.name[0].given[0]");
  });
});

describe("Patient.name = object (array element, object value)", () => {
  let res: { status: number; body: unknown };
  beforeAll(async () => {
    res = await validatePatient({ name: { family: "Ivan" } });
  });
  it("is invalid", () => {
    expect(res).toBeInvalid();
  });
  it("issue points at Patient.name", () => {
    expect(res).toHaveIssueWithExpression("Patient.name");
  });
});

describe("Patient.gender = array (scalar element, array value)", () => {
  let res: { status: number; body: unknown };
  beforeAll(async () => {
    res = await validatePatient({ gender: ["male"] });
  });
  it("is invalid", () => {
    expect(res).toBeInvalid();
  });
  it("issue points at Patient.gender", () => {
    expect(res).toHaveIssueWithExpression("Patient.gender");
  });
});

describe("Patient.name = [] (empty array)", () => {
  let res: { status: number; body: unknown };
  beforeAll(async () => {
    res = await validatePatient({ name: [] });
  });
  it("is invalid", () => {
    expect(res).toBeInvalid();
  });
  it("issue points at Patient.name", () => {
    expect(res).toHaveIssueWithExpression("Patient.name");
  });
});

describe("Patient.name = [{}] (array of empty objects)", () => {
  let res: { status: number; body: unknown };
  beforeAll(async () => {
    res = await validatePatient({ name: [{}] });
  });
  it("is invalid", () => {
    expect(res).toBeInvalid();
  });
  it("issue points at Patient.name[0]", () => {
    expect(res).toHaveIssueWithExpression("Patient.name[0]");
  });
});

describe("Patient.name = [null] (array with null entry)", () => {
  let res: { status: number; body: unknown };
  beforeAll(async () => {
    res = await validatePatient({ name: [null] });
  });
  it("is invalid", () => {
    expect(res).toBeInvalid();
  });
  it("issue points at Patient.name[0]", () => {
    expect(res).toHaveIssueWithExpression("Patient.name[0]");
  });
});

describe("Patient.maritalStatus = {} (empty complex object)", () => {
  let res: { status: number; body: unknown };
  beforeAll(async () => {
    res = await validatePatient({ maritalStatus: {} });
  });
  it("is invalid", () => {
    expect(res).toBeInvalid();
  });
  it("issue points at Patient.maritalStatus", () => {
    expect(res).toHaveIssueWithExpression("Patient.maritalStatus");
  });
});

describe("Patient.maritalStatus = null (null complex)", () => {
  let res: { status: number; body: unknown };
  beforeAll(async () => {
    res = await validatePatient({ maritalStatus: null });
  });
  it("is invalid", () => {
    expect(res).toBeInvalid();
  });
  it("issue points at Patient.maritalStatus", () => {
    expect(res).toHaveIssueWithExpression("Patient.maritalStatus");
  });
});

describe('Patient.birthDate = "" (empty primitive string)', () => {
  let res: { status: number; body: unknown };
  beforeAll(async () => {
    res = await validatePatient({ birthDate: "" });
  });
  it("is invalid", () => {
    expect(res).toBeInvalid();
  });
  it("issue points at Patient.birthDate", () => {
    expect(res).toHaveIssueWithExpression("Patient.birthDate");
  });
});

describe("Patient.birthDate = null (null primitive)", () => {
  let res: { status: number; body: unknown };
  beforeAll(async () => {
    res = await validatePatient({ birthDate: null });
  });
  it("is invalid", () => {
    expect(res).toBeInvalid();
  });
  it("issue points at Patient.birthDate", () => {
    expect(res).toHaveIssueWithExpression("Patient.birthDate");
  });
});

describe("Patient._gender = {} (empty primitive-extension object)", () => {
  let res: { status: number; body: unknown };
  beforeAll(async () => {
    res = await validatePatient({ _gender: {} });
  });
  it("is invalid", () => {
    expect(res).toBeInvalid();
  });
  it("issue points at Patient.gender", () => {
    expect(res).toHaveIssueWithExpression("Patient.gender");
  });
});

describe("Patient._gender = null (null primitive-extension)", () => {
  let res: { status: number; body: unknown };
  beforeAll(async () => {
    res = await validatePatient({ _gender: null });
  });
  it("is invalid", () => {
    expect(res).toBeInvalid();
  });
  it("issue points at Patient.gender", () => {
    expect(res).toHaveIssueWithExpression("Patient.gender");
  });
});
