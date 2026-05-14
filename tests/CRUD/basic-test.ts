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

describe("Patient CRUD", () => {
  let id: string;

  it("create returns 201 and assigns an id", async () => {
    const res = await instance.rest.create("Patient", {
      resourceType: "Patient",
      gender: "male",
    });
    expect(res.status).toBe(201);
    const body = res.body as { resourceType: string; id?: string };
    expect(body.resourceType).toBe("Patient");
    expect(typeof body.id).toBe("string");
    id = body.id as string;
  });

  it("read returns the created resource", async () => {
    const res = await instance.rest.read("Patient", id);
    expect(res.status).toBe(200);
    const body = res.body as { resourceType: string; id: string; gender?: string };
    expect(body.resourceType).toBe("Patient");
    expect(body.id).toBe(id);
    expect(body.gender).toBe("male");
  });

  it("update changes the resource", async () => {
    const res = await instance.rest.update("Patient", id, {
      resourceType: "Patient",
      id,
      gender: "female",
    });
    expect([200, 201]).toContain(res.status);
    const body = res.body as { resourceType: string; id: string; gender?: string };
    expect(body.id).toBe(id);
    expect(body.gender).toBe("female");
  });

  it("read after update reflects the change", async () => {
    const res = await instance.rest.read("Patient", id);
    expect(res.status).toBe(200);
    const body = res.body as { gender?: string };
    expect(body.gender).toBe("female");
  });

  it("delete removes the resource", async () => {
    const res = await instance.rest.delete("Patient", id);
    expect([200, 202, 204]).toContain(res.status);
  });

  it("read after delete returns 404 or 410", async () => {
    const res = await instance.rest.read("Patient", id);
    expect([404, 410]).toContain(res.status);
  });
});

// FHIR R4 §2.36.0.7: on create, "any id provided by the client SHALL be ignored".
describe("create with id in body", () => {
  it("server ignores client-supplied id and assigns its own", async () => {
    const clientId = "client-supplied-id-fhir262";
    const res = await instance.rest.create("Patient", {
      resourceType: "Patient",
      id: clientId,
      gender: "male",
    });
    expect(res.status).toBe(201);
    const body = res.body as { resourceType: string; id?: string };
    expect(body.resourceType).toBe("Patient");
    expect(typeof body.id).toBe("string");
    expect(body.id).not.toBe(clientId);
  });
});

// FHIR R4 §2.36.0.10: on update, if resource.id differs from the URL [id],
// the server SHALL return 400 Bad Request.
describe("update with id mismatch between url and body", () => {
  it("returns 400", async () => {
    const res = await instance.rest.update("Patient", "fhir262-url-id", {
      resourceType: "Patient",
      id: "fhir262-body-id",
      gender: "male",
    });
    expect(res.status).toBe(400);
  });
});
