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

const validPatient = { resourceType: "Patient", id: "example" };
// Patient.name is 0..* HumanName; a primitive string violates the type.
const invalidPatient = { resourceType: "Patient", name: "John" };

const parametersWrapping = (resource: unknown) => ({
  resourceType: "Parameters",
  parameter: [{ name: "resource", resource }],
});

describe("type-level URL /Patient/$validate, Parameters-wrapped body", () => {
  it("accepts a valid Patient wrapped in Parameters", async () => {
    const res = await instance.rest.operation(
      "Patient",
      "$validate",
      parametersWrapping(validPatient),
    );
    expect(res).toBeValid();
  });

  describe("invalid Patient wrapped in Parameters", () => {
    let res: { status: number; body: unknown };
    beforeAll(async () => {
      res = await instance.rest.operation(
        "Patient",
        "$validate",
        parametersWrapping(invalidPatient),
      );
    });
    it("is invalid", () => {
      expect(res).toBeInvalid();
    });
    it("issue expression starts at Patient, not at Parameters", () => {
      expect(res).toHaveIssueWithExpression("Patient.name");
    });
  });
});

describe("system-level URL /$validate, Parameters-wrapped body", () => {
  it("accepts a valid Patient wrapped in Parameters", async () => {
    const res = await instance.rest.systemOperation(
      "$validate",
      parametersWrapping(validPatient),
    );
    expect(res).toBeValid();
  });

  describe("invalid Patient wrapped in Parameters", () => {
    let res: { status: number; body: unknown };
    beforeAll(async () => {
      res = await instance.rest.systemOperation(
        "$validate",
        parametersWrapping(invalidPatient),
      );
    });
    it("is invalid", () => {
      expect(res).toBeInvalid();
    });
    it("issue expression starts at Patient, not at Parameters", () => {
      expect(res).toHaveIssueWithExpression("Patient.name");
    });
  });
});

describe("type-level URL /Patient/$validate, resource posted directly (no Parameters wrapper)", () => {
  it("accepts a valid Patient body", async () => {
    const res = await instance.rest.operation("Patient", "$validate", validPatient);
    expect(res).toBeValid();
  });
});

describe("Parameters.resource cardinality (0..1, required unless mode=delete or instance-level)", () => {
  it("rejects a Parameters body with no resource parameter", async () => {
    const res = await instance.rest.operation("Patient", "$validate", {
      resourceType: "Parameters",
      parameter: [],
    });
    expect(res).toBeInvalid();
  });
});
