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

describe("minimal resource (Patient)", () => {
  it("is valid", async () => {
    const res = await instance.rest.operation("Patient", "$validate", {
      resourceType: "Patient",
      id: "example",
    });
    expect(res).toBeValid();
  });
});

describe("primitive value at a complex element (Patient.name)", () => {
  let res: { status: number; body: unknown };
  beforeAll(async () => {
    res = await instance.rest.operation("Patient", "$validate", {
      resourceType: "Patient",
      name: "John",
    });
  });
  it("is invalid", () => {
    expect(res).toBeInvalid();
  });
  it("issue points at Patient.name", () => {
    expect(res).toHaveIssueWithExpression("Patient.name");
  });
});

describe("valid code at a bound element (Patient.gender)", () => {
  it("is valid", async () => {
    const res = await instance.rest.operation("Patient", "$validate", {
      resourceType: "Patient",
      gender: "male",
    });
    expect(res).toBeValid();
  });
});

describe("invalid code at a bound element (Patient.gender)", () => {
  let res: { status: number; body: unknown };
  beforeAll(async () => {
    res = await instance.rest.operation("Patient", "$validate", {
      resourceType: "Patient",
      gender: "mmale",
    });
  });
  it("is invalid", () => {
    expect(res).toBeInvalid();
  });
  it("issue points at Patient.gender", () => {
    expect(res).toHaveIssueWithExpression("Patient.gender");
  });
});
