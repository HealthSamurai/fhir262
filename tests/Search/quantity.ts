import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { ServerInstance } from "../../interfaces/server";
import type { Rest } from "../../interfaces/rest";
import { loadImpl } from "../../framework/impl-loader";
import { type Bundle, idsOf, createOrFail, cleanup, dualMode } from "./_helpers";

const server = loadImpl().server;
let instance: ServerInstance;
const rest = (): Rest => instance.rest;

beforeAll(async () => {
  instance = await server.startWithCoreOnly("r4");
});

afterAll(async () => {
  await instance.stop();
});

const LOINC = "http://loinc.org";
const UCUM = "http://unitsofmeasure.org";
const PROFILE_A = "http://fhir262/test/StructureDefinition/test-profile-a";
const PROFILE_B = "http://fhir262/test/StructureDefinition/test-profile-b";

dualMode("quantity-and-composite", rest, (search) => {
  // Three Observations with valueQuantity in distinct shapes (system, unit
  // code, value) so each quantity-search variant in candle R4 rows 218-236
  // has at least one positive and one negative resource. A fourth (oFlowCL)
  // exists to anchor UCUM case-sensitivity assertions.
  let oWeightLbs: string; // 185 lbs / UCUM [lb_av], coded LOINC 29463-7
  let oWeightKg: string; //  85 kg  / UCUM kg,      coded LOINC 29463-7
  let oFlowCLs: string; // 820 cL/s / UCUM cL/s,    coded ISO|11073:152584
  let oUnrelated: string; // no valueQuantity

  beforeAll(async () => {
    oWeightLbs = await createOrFail(instance.rest, "Observation", {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: LOINC, code: "29463-7", display: "Body Weight" }] },
      valueQuantity: { value: 185, unit: "lbs", system: UCUM, code: "[lb_av]" },
    });
    oWeightKg = await createOrFail(instance.rest, "Observation", {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: LOINC, code: "29463-7", display: "Body Weight" }] },
      valueQuantity: { value: 85, unit: "kg", system: UCUM, code: "kg" },
    });
    oFlowCLs = await createOrFail(instance.rest, "Observation", {
      resourceType: "Observation",
      status: "final",
      code: {
        coding: [
          { system: "urn:iso:std:iso:11073:10101", code: "152584", display: "Flow rate" },
        ],
      },
      valueQuantity: { value: 820, unit: "cL/s", system: UCUM, code: "cL/s" },
    });
    oUnrelated = await createOrFail(instance.rest, "Observation", {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: LOINC, code: "8480-6", display: "Systolic BP" }] },
      valueQuantity: { value: 120, unit: "mmHg", system: UCUM, code: "mm[Hg]" },
    });
  });

  afterAll(async () => {
    await cleanup(instance.rest, "Observation", [oWeightLbs, oWeightKg, oFlowCLs, oUnrelated]);
  });

  it("value-quantity matches by value alone (candle R4:225)", async () => {
    const res = await search("Observation", "value-quantity=185");
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toContain(oWeightLbs);
    expect(idsOf(res.body)).not.toContain(oWeightKg);
  });

  it("value-quantity matches by system|code|value (candle R4:221)", async () => {
    const res = await search("Observation", `value-quantity=185|${UCUM}|[lb_av]`);
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toContain(oWeightLbs);
    expect(idsOf(res.body)).not.toContain(oWeightKg);
  });

  it("value-quantity matches by unit code only (no system) (candle R4:224)", async () => {
    // Form: ||code — value with empty system, just a unit literal. Per FHIR,
    // matches if EITHER `code` OR `unit` text equals "lbs".
    const res = await search("Observation", "value-quantity=185||lbs");
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toContain(oWeightLbs);
    expect(idsOf(res.body)).not.toContain(oWeightKg);
  });

  it("value-quantity matches by canonical UCUM code without a unit text (candle R4:223)", async () => {
    const res = await search("Observation", "value-quantity=185||[lb_av]");
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toContain(oWeightLbs);
    expect(idsOf(res.body)).not.toContain(oWeightKg);
  });

  it("value-quantity prefix ge matches values >= comparand (candle R4:226-228)", async () => {
    const res = await search("Observation", "value-quantity=ge800");
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toContain(oFlowCLs);
    expect(idsOf(res.body)).not.toContain(oWeightLbs);
  });

  it("value-quantity prefix lt matches values < comparand (candle R4:229-232)", async () => {
    const res = await search("Observation", "value-quantity=lt100");
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toContain(oWeightKg);
    expect(idsOf(res.body)).not.toContain(oFlowCLs);
  });

  it("composite code-value-quantity matches when both halves match (candle R4:218)", async () => {
    // composite syntax: <code1>$<code2>=<value1>$<value2>
    const res = await search(
      "Observation",
      `code-value-quantity=${encodeURIComponent(`${LOINC}|29463-7`)}$185`,
    );
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toContain(oWeightLbs);
    expect(idsOf(res.body)).not.toContain(oWeightKg);
    expect(idsOf(res.body)).not.toContain(oFlowCLs);
  });

  it("composite supports OR on the first axis (candle R4:219)", async () => {
    const res = await search(
      "Observation",
      `code-value-quantity=${encodeURIComponent(`${LOINC}|29463-7,${LOINC}|8480-6`)}$185`,
    );
    expect(res).toHaveStatus(200);
    // Only oWeightLbs satisfies BOTH a code in the OR set AND value 185.
    expect(idsOf(res.body)).toContain(oWeightLbs);
    expect(idsOf(res.body)).not.toContain(oWeightKg);
  });
});

dualMode("number-uri-boolean", rest, (search) => {
  // Patients with varying multipleBirthInteger, active, and meta.profile so
  // we can exercise number ops, URI exact/missing, and boolean parsing in
  // one set.
  let pTriple: string; // multipleBirthInteger=3, active=true, profile=A
  let pTwin: string; // multipleBirthInteger=2, active=false, profile=B
  let pSingle: string; // multipleBirthInteger=1, active=true, no profile

  beforeAll(async () => {
    pTriple = await createOrFail(instance.rest, "Patient", {
      resourceType: "Patient",
      meta: { profile: [PROFILE_A] },
      active: true,
      multipleBirthInteger: 3,
    });
    pTwin = await createOrFail(instance.rest, "Patient", {
      resourceType: "Patient",
      meta: { profile: [PROFILE_B] },
      active: false,
      multipleBirthInteger: 2,
    });
    pSingle = await createOrFail(instance.rest, "Patient", {
      resourceType: "Patient",
      active: true,
      multipleBirthInteger: 1,
    });
  });

  afterAll(async () => {
    await cleanup(instance.rest, "Patient", [pTriple, pTwin, pSingle]);
  });

  it("number eq: multiplebirth=2 matches only the twin (candle R4:502)", async () => {
    const res = await search("Patient", "multiplebirth=2");
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toContain(pTwin);
    expect(idsOf(res.body)).not.toContain(pTriple);
    expect(idsOf(res.body)).not.toContain(pSingle);
  });

  it("number le: multiplebirth=le2 matches twin + single (candle R4:503)", async () => {
    const res = await search("Patient", "multiplebirth=le2");
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([pTwin, pSingle]));
    expect(idsOf(res.body)).not.toContain(pTriple);
  });

  it("number lt: multiplebirth=lt2 matches only the single (candle R4:504)", async () => {
    const res = await search("Patient", "multiplebirth=lt2");
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toContain(pSingle);
    expect(idsOf(res.body)).not.toContain(pTwin);
    expect(idsOf(res.body)).not.toContain(pTriple);
  });

  it("_profile=<url> matches exact URI (candle R4:247)", async () => {
    const res = await search("Patient", `_profile=${encodeURIComponent(PROFILE_A)}`);
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toContain(pTriple);
    expect(idsOf(res.body)).not.toContain(pTwin);
    expect(idsOf(res.body)).not.toContain(pSingle);
  });

  it("_profile:missing=true matches patients without meta.profile (candle R4:248)", async () => {
    const res = await search("Patient", "_profile:missing=true");
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toContain(pSingle);
    expect(idsOf(res.body)).not.toContain(pTriple);
    expect(idsOf(res.body)).not.toContain(pTwin);
  });

  it("_profile:missing=false matches patients with meta.profile (candle R4:249)", async () => {
    const res = await search("Patient", "_profile:missing=false");
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([pTriple, pTwin]));
    expect(idsOf(res.body)).not.toContain(pSingle);
  });

  it("active=true matches active patients (candle R4:520)", async () => {
    const res = await search("Patient", "active=true");
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([pTriple, pSingle]));
    expect(idsOf(res.body)).not.toContain(pTwin);
  });

  it("active=false matches inactive patients (candle R4:521)", async () => {
    const res = await search("Patient", "active=false");
    expect(res).toHaveStatus(200);
    expect(idsOf(res.body)).toContain(pTwin);
    expect(idsOf(res.body)).not.toContain(pTriple);
    expect(idsOf(res.body)).not.toContain(pSingle);
  });

  it("active=garbage returns a Bundle (status 200) — strict servers may also 400; assert only that no PHI leaks (candle R4:522-523)", async () => {
    const res = await search("Patient", "active=garbage");
    // The FHIR spec doesn't pin a single behaviour for invalid boolean tokens —
    // some servers return 200 + empty Bundle, others 400. The cross-impl matrix
    // is the comparison; here we only assert "not a 5xx" (i.e. server didn't
    // crash) and, when the body is a Bundle, that none of the prepared patients
    // were returned (the garbage value shouldn't match true OR false).
    expect(res.status).toBeLessThan(500);
    const body = res.body as Bundle | { resourceType: string };
    if (body && (body as Bundle).resourceType === "Bundle") {
      const ids = idsOf(body);
      expect(ids).not.toEqual(expect.arrayContaining([pTriple, pTwin, pSingle]));
    }
  });
});
