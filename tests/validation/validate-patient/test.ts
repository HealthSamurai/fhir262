import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { ServerInstance } from "../../../interfaces/server";
import { loadImpl } from "../../../framework/impl-loader";

const server = loadImpl().server;
let instance: ServerInstance;

beforeAll(async () => {
  instance = await server.startWithCoreOnly("r4");
});

afterAll(async () => {
  await instance.stop();
});

describe("simple validation", () => {
  it("validates a minimal Patient with no errors", async () => {
    const res = await instance.rest.operation("Patient", "$validate", {
      resourceType: "Patient",
      id: "example",
    });
    expect(res).toBeValid();
  });

  it("reports an error when Patient.name has the wrong type", async () => {
    const res = await instance.rest.operation("Patient", "$validate", {
      resourceType: "Patient",
      name: "John",
    });
    expect(res).toBeInvalid();
    expect(res).toHaveIssueAt("Patient.name");
  });

  it("accepts a Patient with a valid gender code", async () => {
    const res = await instance.rest.operation("Patient", "$validate", {
      resourceType: "Patient",
      gender: "male",
    });
    expect(res).toBeValid();
  });

  it("reports an error for a Patient with an invalid gender code", async () => {
    const res = await instance.rest.operation("Patient", "$validate", {
      resourceType: "Patient",
      gender: "mmale",
    });
    expect(res).toBeInvalid();
    expect(res).toHaveIssueAt("Patient.gender");
  });
});
