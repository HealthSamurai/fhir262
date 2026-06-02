import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { ServerInstance } from "../../interfaces/server";
import type { Rest } from "../../interfaces/rest";
import { loadImpl } from "../../framework/impl-loader";
import {
  IDENT_SYSTEM,
  idsOf,
  matchIds,
  includedEntries,
  createOrFail,
  cleanup,
  dualMode,
} from "./_helpers";

const server = loadImpl().server;
let instance: ServerInstance;
const rest = (): Rest => instance.rest;

beforeAll(async () => {
  instance = await server.startWithCoreOnly("r4");
});

afterAll(async () => {
  await instance.stop();
});

const PATIENT_IDENT = "urn:oid:1.2.3.4";

dualMode("related-resources", rest, (search) => {
  // Two Patients (peter, other) and three Observations:
  //   - oBp        : subject=peter, id="bp-related-resources"  (named so _has tests pin it)
  //   - oTemp      : subject=peter
  //   - oOther     : subject=other
  // peter carries an Identifier so `:identifier` reference modifiers can fire.
  let pPeter: string;
  let pOther: string;
  let oBp: string;
  let oTemp: string;
  let oOther: string;

  beforeAll(async () => {
    pPeter = await createOrFail(instance.rest, "Patient", {
      resourceType: "Patient",
      identifier: [{ system: PATIENT_IDENT, value: "12345" }],
      name: [{ given: ["peter"], family: "Pan" }],
    });
    pOther = await createOrFail(instance.rest, "Patient", {
      resourceType: "Patient",
      identifier: [{ system: PATIENT_IDENT, value: "99999" }],
      name: [{ given: ["other"], family: "Person" }],
    });
    // Use PUT to seed a stable id "bp-related-resources" so _has tests can
    // match it by _id without first having to look it up.
    const bpPut = await instance.rest.update("Observation", "bp-related-resources", {
      resourceType: "Observation",
      id: "bp-related-resources",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "85354-9" }] },
      subject: { reference: `Patient/${pPeter}` },
    });
    if (bpPut.status !== 200 && bpPut.status !== 201) {
      throw new Error(`seed: bp-related-resources PUT failed: ${bpPut.status}`);
    }
    oBp = "bp-related-resources";
    oTemp = await createOrFail(instance.rest, "Observation", {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "8310-5" }] },
      subject: { reference: `Patient/${pPeter}` },
    });
    oOther = await createOrFail(instance.rest, "Observation", {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "85354-9" }] },
      subject: { reference: `Patient/${pOther}` },
    });
  });

  afterAll(async () => {
    await cleanup(instance.rest, "Observation", [oBp, oTemp, oOther]);
    await cleanup(instance.rest, "Patient", [pPeter, pOther]);
  });

  it("reference: subject=Patient/{id} matches Observations referencing that Patient (candle R4:239)", async () => {
    const res = await search("Observation", `subject=Patient/${pPeter}`);
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([oBp, oTemp]));
    expect(idsOf(res.body)).not.toContain(oOther);
  });

  it("reference: subject:Patient=Patient/{id} narrows to typed reference (candle R4:240)", async () => {
    const res = await search("Observation", `subject:Patient=Patient/${pPeter}`);
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([oBp, oTemp]));
    expect(idsOf(res.body)).not.toContain(oOther);
  });

  it("reference: subject:Device=Patient/{id} returns nothing for the wrong type (candle R4:241)", async () => {
    const res = await search("Observation", `subject:Device=Patient/${pPeter}`);
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).not.toContain(oBp);
    expect(ids).not.toContain(oTemp);
    expect(ids).not.toContain(oOther);
  });

  it("reference: untyped subject={id} resolves to the typed target (candle R4:243)", async () => {
    const res = await search("Observation", `subject=${pPeter}`);
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([oBp, oTemp]));
    expect(idsOf(res.body)).not.toContain(oOther);
  });

  it("reference: dangling reference (unknown id) returns nothing (candle R4:242)", async () => {
    const res = await search("Observation", "subject=Patient/this-id-does-not-exist-xyz");
    expect(res).toHaveStatus(200);
    const ids = idsOf(res.body);
    expect(ids).not.toContain(oBp);
    expect(ids).not.toContain(oTemp);
    expect(ids).not.toContain(oOther);
  });

  it("reference: subject:identifier=system|value resolves via the target's identifier (candle R5:222-224)", async () => {
    const res = await search(
      "Observation",
      `subject:identifier=${encodeURIComponent(`${PATIENT_IDENT}|12345`)}`,
    );
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([oBp, oTemp]));
    expect(idsOf(res.body)).not.toContain(oOther);
  });

  it("chain: subject.name=peter matches Observations whose Patient.name has 'peter' (candle R4:250)", async () => {
    const res = await search("Observation", "subject.name=peter");
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([oBp, oTemp]));
    expect(idsOf(res.body)).not.toContain(oOther);
  });

  it("chain: subject:Patient.name=peter constrains the chain to Patient targets (candle R4:251)", async () => {
    const res = await search("Observation", "subject:Patient.name=peter");
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([oBp, oTemp]));
    expect(idsOf(res.body)).not.toContain(oOther);
  });

  it("chain: subject._id={patientId} matches via the chained patient id (candle R4:252-253)", async () => {
    const res = await search("Observation", `subject._id=${pPeter}`);
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([oBp, oTemp]));
    expect(idsOf(res.body)).not.toContain(oOther);
  });

  it("_has:Observation:patient:_id={obsId} reverse-chains via Observation.patient (candle R4:530)", async () => {
    // Note: Observation.subject is the source-of-truth reference, but
    // Observation also defines a `patient` search param targeting the
    // Patient-typed subject. Both candle R4:530 and R4:531 should match.
    const res = await search("Patient", `_has:Observation:patient:_id=${oBp}`);
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toContain(pPeter);
    expect(idsOf(res.body)).not.toContain(pOther);
  });

  it("_has:Observation:subject:_id={obsId} reverse-chains via Observation.subject (candle R4:531)", async () => {
    const res = await search("Patient", `_has:Observation:subject:_id=${oBp}`);
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toContain(pPeter);
    expect(idsOf(res.body)).not.toContain(pOther);
  });

  it("_include=Observation:patient adds the referenced Patient as an include entry (candle R4:217)", async () => {
    const res = await search(
      "Observation",
      `subject=Patient/${pPeter}&_include=Observation:patient`,
    );
    expect(res).toHaveStatus(200);
    const matches = matchIds(res.body);
    const includes = includedEntries(res.body).map((e) => e.resource.id);
    expect(matches).toEqual(expect.arrayContaining([oBp, oTemp]));
    expect(includes).toContain(pPeter);
  });

  it("_revinclude=Observation:patient pulls back Observations referencing the Patient (candle R4:487)", async () => {
    const res = await search("Patient", `_id=${pPeter}&_revinclude=Observation:patient`);
    expect(res).toHaveStatus(200);
    const matches = matchIds(res.body);
    const includes = includedEntries(res.body).map((e) => e.resource.id);
    expect(matches).toContain(pPeter);
    expect(includes).toEqual(expect.arrayContaining([oBp, oTemp]));
  });

  it("_include with a chained filter: _include=Observation:patient & subject._id={id} (candle R4:254)", async () => {
    const res = await search(
      "Observation",
      `subject._id=${pPeter}&_include=Observation:patient`,
    );
    expect(res).toHaveStatus(200);
    const matches = matchIds(res.body);
    const includes = includedEntries(res.body).map((e) => e.resource.id);
    expect(matches).toEqual(expect.arrayContaining([oBp, oTemp]));
    expect(includes).toContain(pPeter);
  });
});
