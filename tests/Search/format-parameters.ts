import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { ServerInstance } from "../../interfaces/server";
import type { Rest } from "../../interfaces/rest";
import { loadImpl } from "../../framework/impl-loader";
import {
  IDENT_SYSTEM,
  type Bundle,
  type BundleEntry,
  idsOf,
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

// Lightweight typed shapes so we can poke at Patient narrative + photo without
// a top-level dependency on a FHIR resource type library.
type PatientWithText = {
  resourceType: "Patient";
  id: string;
  text?: { status?: string; div?: string };
  photo?: { contentType?: string; data?: string }[];
  meta?: { lastUpdated?: string; profile?: string[] };
};

const patientFromEntry = (e?: BundleEntry): PatientWithText | undefined =>
  e?.resource as unknown as PatientWithText | undefined;

dualMode("summary-and-total", rest, (search) => {
  const patientIds: string[] = [];

  beforeAll(async () => {
    for (let i = 1; i <= 5; i++) {
      const id = await createOrFail(instance.rest, "Patient", {
        resourceType: "Patient",
        identifier: [{ system: IDENT_SYSTEM, value: `SUM-${i}` }],
        name: [{ family: `Summ${i}` }],
        gender: i % 2 === 0 ? "female" : "male",
        text: {
          status: "generated",
          div: `<div xmlns="http://www.w3.org/1999/xhtml">Summ${i}</div>`,
        },
        // Tiny inline photo to verify _summary=true / _summary=data drop it.
        photo: [
          {
            contentType: "image/gif",
            // 1x1 transparent gif, base64.
            data: "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
          },
        ],
      });
      patientIds.push(id);
    }
  });

  afterAll(async () => {
    await cleanup(instance.rest, "Patient", patientIds);
  });

  const baseQuery = `identifier=${IDENT_SYSTEM}|`;

  it("_summary=false returns the full resource including photo (candle R4Summary:2501)", async () => {
    const res = await search("Patient", `${baseQuery}&_summary=false`);
    expect(res).toHaveStatus(200);
    const p = patientFromEntry((res.body as Bundle).entry?.[0]);
    expect(p).toBeDefined();
    expect(p?.photo?.[0]?.data).toBeTruthy();
    expect(p?.text?.div).toBeTruthy();
  });

  it("_summary=count returns Bundle.total but no entries (candle R4Summary:2504)", async () => {
    const res = await search("Patient", `${baseQuery}&_summary=count`);
    expect(res).toHaveStatus(200);
    const body = res.body as Bundle;
    expect(body.total).toBe(5);
    expect(body.entry ?? []).toEqual([]);
  });

  it("_summary=true omits non-summary elements like Patient.photo", async () => {
    const res = await search("Patient", `${baseQuery}&_summary=true`);
    expect(res).toHaveStatus(200);
    const p = patientFromEntry((res.body as Bundle).entry?.[0]);
    expect(p).toBeDefined();
    expect(p?.photo).toBeUndefined();
  });

  it("_summary=text keeps narrative + meta and drops other elements", async () => {
    const res = await search("Patient", `${baseQuery}&_summary=text`);
    expect(res).toHaveStatus(200);
    const p = patientFromEntry((res.body as Bundle).entry?.[0]);
    expect(p).toBeDefined();
    expect(p?.text?.div).toBeTruthy();
    expect(p?.photo).toBeUndefined();
  });

  it("_summary=data omits the narrative (Patient.text)", async () => {
    const res = await search("Patient", `${baseQuery}&_summary=data`);
    expect(res).toHaveStatus(200);
    const p = patientFromEntry((res.body as Bundle).entry?.[0]);
    expect(p).toBeDefined();
    expect(p?.text?.div).toBeUndefined();
  });

  it("Bundle.total is invariant across _summary values (candle R4Summary:2507-2510)", async () => {
    // _summary=count tends to be the cheapest accurate total signal because
    // servers can skip query materialisation. Use it as the reference and
    // compare against _summary=false and _summary=true.
    const [resCount, resFalse, resTrue] = await Promise.all([
      search("Patient", `${baseQuery}&_summary=count`),
      search("Patient", `${baseQuery}&_summary=false&_total=accurate`),
      search("Patient", `${baseQuery}&_summary=true&_total=accurate`),
    ]);
    expect(resCount).toHaveStatus(200);
    expect(resFalse).toHaveStatus(200);
    expect(resTrue).toHaveStatus(200);
    const baseline = (resCount.body as Bundle).total;
    expect(baseline).toBe(5);
    expect((resFalse.body as Bundle).total).toBe(baseline);
    expect((resTrue.body as Bundle).total).toBe(baseline);
  });

  it("self link echoes _summary= (candle R4Summary:2513)", async () => {
    const res = await search("Patient", `${baseQuery}&_summary=count`);
    expect(res).toHaveStatus(200);
    expect(res).toHaveSelfLinkContaining([`identifier=${IDENT_SYSTEM}|`, "_summary=count"]);
  });

  it("_total=none omits Bundle.total", async () => {
    const res = await search("Patient", `${baseQuery}&_total=none`);
    expect(res).toHaveStatus(200);
    expect((res.body as Bundle).total).toBeUndefined();
  });

  it("_total=estimate returns a numeric total (no exact-match assertion)", async () => {
    const res = await search("Patient", `${baseQuery}&_total=estimate`);
    expect(res).toHaveStatus(200);
    const t = (res.body as Bundle).total;
    // Servers that don't support estimate-mode usually fall through to exact.
    // Both are acceptable; the only failure mode is `undefined`.
    expect(typeof t).toBe("number");
  });

  it("_count=0 returns no entries (Bundle is total-only)", async () => {
    const res = await search("Patient", `${baseQuery}&_count=0&_total=accurate`);
    expect(res).toHaveStatus(200);
    const body = res.body as Bundle;
    expect(body.entry ?? []).toEqual([]);
    expect(body.total).toBe(5);
  });

  it("_count=N paging: walking next-links covers every match once, no duplicates", async () => {
    const seen = new Set<string>();
    let url = `${baseQuery}&_count=2&_total=accurate`;
    let pages = 0;
    let runningTotal: number | undefined;

    while (url && pages < 10) {
      const res =
        pages === 0
          ? await search("Patient", url)
          : await rest().searchUrl(url);
      expect(res).toHaveStatus(200);
      const body = res.body as Bundle;
      runningTotal = body.total ?? runningTotal;
      const pageIds = idsOf(body);
      for (const id of pageIds) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      const next = (body.link ?? []).find((l) => l.relation === "next");
      url = next?.url ?? "";
      pages++;
    }
    // 5 patients with _count=2 → at minimum 3 pages of (2, 2, 1).
    // Some servers (e.g. fhir-candle) page differently; pin the invariant
    // rather than the exact page count.
    expect(seen.size).toBe(5);
    if (runningTotal !== undefined) expect(runningTotal).toBe(5);
  });
});
