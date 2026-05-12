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

describe("validate-patient", () => {
  it("validates a minimal Patient with no issues", async () => {
    const res = await instance.rest.operation("Patient", "validate", {
      resourceType: "Patient",
      id: "example",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      resourceType: "OperationOutcome",
      issue: [],
    });
  });
});
