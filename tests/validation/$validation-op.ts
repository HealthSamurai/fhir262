import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { ServerConnection } from "../../interfaces/server";
import { loadImpl } from "../../framework/impl-loader";

const server = loadImpl().server;
let connection: ServerConnection;

beforeAll(async () => {
  connection = await server.connect({ fhirVersion: "r4" });
});

afterAll(async () => {
  await connection.close();
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
    const res = await connection.rest.operation(
      "Patient",
      "$validate",
      parametersWrapping(validPatient),
    );
    expect(res).toBeValid();
  });

  describe("invalid Patient wrapped in Parameters", () => {
    let res: { status: number; body: unknown };
    beforeAll(async () => {
      res = await connection.rest.operation(
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
    const res = await connection.rest.systemOperation(
      "$validate",
      parametersWrapping(validPatient),
    );
    expect(res).toBeValid();
  });

  describe("invalid Patient wrapped in Parameters", () => {
    let res: { status: number; body: unknown };
    beforeAll(async () => {
      res = await connection.rest.systemOperation(
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
    const res = await connection.rest.operation("Patient", "$validate", validPatient);
    expect(res).toBeValid();
  });
});

describe("Parameters.resource cardinality (0..1, required unless mode=delete or instance-level)", () => {
  it("rejects a Parameters body with no resource parameter", async () => {
    const res = await connection.rest.operation("Patient", "$validate", {
      resourceType: "Parameters",
      parameter: [],
    });
    expect(res).toBeInvalid();
  });
});
