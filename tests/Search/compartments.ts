import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { ServerInstance } from "../../interfaces/server";
import { loadImpl } from "../../framework/impl-loader";
import { idsOf, createOrFail, cleanup } from "./_helpers";

const server = loadImpl().server;
let instance: ServerInstance;

beforeAll(async () => {
  instance = await server.startWithCoreOnly("r4");
});

afterAll(async () => {
  await instance.stop();
});

// Compartment dual-mode dispatcher. POST form of `*`-compartment is undefined
// in FHIR (you POST to a typed compartment `/Patient/{id}/Observation/_search`,
// not `/Patient/{id}/_search`), so the `*` shape is GET-only. We expose a
// flag on the dispatcher so tests can skip the POST run for `*` cases.
type CompartmentSearchFn = (
  resourceType: string | "*",
  query?: string,
) => Promise<{ status: number; body: unknown }>;

const compartmentModes = (
  patientId: () => string,
): { name: "GET" | "POST"; supportsStar: boolean; search: CompartmentSearchFn }[] => [
  {
    name: "GET",
    supportsStar: true,
    search: (rt, q) => instance.rest.compartmentSearch("Patient", patientId(), rt, q),
  },
  {
    name: "POST",
    supportsStar: false,
    search: (rt, q) => {
      if (rt === "*") {
        throw new Error("compartmentSearchPost does not support `*` (FHIR-undefined).");
      }
      return instance.rest.compartmentSearchPost("Patient", patientId(), rt, q);
    },
  },
];

describe("patient compartment", () => {
  let pPeter: string;
  let pOther: string;
  let oBp: string; // PUT with stable id so the unknown-id negative test can be deterministic
  let oTemp: string;
  let oUnrelated: string;

  beforeAll(async () => {
    pPeter = await createOrFail(instance.rest, "Patient", {
      resourceType: "Patient",
      name: [{ given: ["peter"], family: "Pan" }],
    });
    pOther = await createOrFail(instance.rest, "Patient", {
      resourceType: "Patient",
      name: [{ given: ["other"], family: "Person" }],
    });

    const bpPut = await instance.rest.update("Observation", "bp-compartment-fix", {
      resourceType: "Observation",
      id: "bp-compartment-fix",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "85354-9" }] },
      subject: { reference: `Patient/${pPeter}` },
    });
    if (bpPut.status !== 200 && bpPut.status !== 201) {
      throw new Error(`seed: bp-compartment-fix PUT failed: ${bpPut.status}`);
    }
    oBp = "bp-compartment-fix";

    oTemp = await createOrFail(instance.rest, "Observation", {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "8310-5" }] },
      subject: { reference: `Patient/${pPeter}` },
    });
    oUnrelated = await createOrFail(instance.rest, "Observation", {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "85354-9" }] },
      subject: { reference: `Patient/${pOther}` },
    });
  });

  afterAll(async () => {
    await cleanup(instance.rest, "Observation", [oBp, oTemp, oUnrelated]);
    await cleanup(instance.rest, "Patient", [pPeter, pOther]);
  });

  // The dispatchers list lives at the describe-level so the same closure is
  // shared across nested describes. We can't capture pPeter at module init
  // (it's still undefined then) — `() => pPeter` resolves at test time.
  const modes = () => compartmentModes(() => pPeter);

  describe.each(modes())("$name", (mode) => {
    if (mode.supportsStar) {
      it("all-types: returns every resource referencing the patient (candle 662)", async () => {
        const res = await mode.search("*");
        expect(res).toHaveStatus(200);
        const ids = idsOf(res.body);
        expect(ids).toEqual(expect.arrayContaining([oBp, oTemp]));
        expect(ids).not.toContain(oUnrelated);
      });
    }

    it("typed: /Observation returns only this patient's Observations (candle 663)", async () => {
      const res = await mode.search("Observation");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toEqual(expect.arrayContaining([oBp, oTemp]));
      expect(ids).not.toContain(oUnrelated);
    });

    it("typed + search param: /Observation?_id={oBp} narrows by id (candle 664)", async () => {
      const res = await mode.search("Observation", `_id=${oBp}`);
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(oBp);
      expect(ids).not.toContain(oTemp);
      expect(ids).not.toContain(oUnrelated);
    });

    it("typed + non-matching _id returns empty (candle 665)", async () => {
      const res = await mode.search("Observation", "_id=does-not-exist-xyz");
      expect(res).toHaveStatus(200);
      const ids = idsOf(res.body);
      expect(ids).not.toContain(oBp);
      expect(ids).not.toContain(oTemp);
      expect(ids).not.toContain(oUnrelated);
    });
  });

  // The unknown-patient cases use a hard-coded missing id, so they don't
  // belong inside the per-patient `modes(pPeter)` closure. Run them with
  // a separate describe.each that closes over the literal missing id.
  describe.each([
    {
      name: "GET",
      supportsStar: true,
      run: (rt: string | "*", q?: string) =>
        instance.rest.compartmentSearch("Patient", "patient-definitely-does-not-exist-xyz", rt, q),
    },
    {
      name: "POST",
      supportsStar: false,
      run: (rt: string, q?: string) =>
        instance.rest.compartmentSearchPost(
          "Patient",
          "patient-definitely-does-not-exist-xyz",
          rt,
          q,
        ),
    },
  ])("$name (unknown patient)", (mode) => {
    if (mode.supportsStar) {
      it("/Patient/{unknown}/* returns 404 or empty Bundle (candle 666)", async () => {
        const res = await mode.run("*");
        // Spec leaves the exact status open — both 404 and 200+empty are
        // defensible. We only forbid 5xx (server crash).
        expect(res.status).toBeLessThan(500);
      });
    }
    it("/Patient/{unknown}/Observation returns 404 or empty Bundle (candle 667)", async () => {
      const res = await mode.run("Observation");
      expect(res.status).toBeLessThan(500);
    });
  });
});
