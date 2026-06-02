// Shared test helpers for tests/Search/**.
//
// Lifted from the per-file duplicates that grew across `basic.ts` /
// `intervals.ts` and the new files added in §5 of the plan. Two shapes
// live here:
//
// 1) Tiny domain helpers (`idsOf`, `createOrFail`, `cleanup`, ...) that
//    operate against an injected `Rest`. They take `rest` as the first
//    argument so the dual-mode dispatcher (#2 below) can compose them
//    without each call site juggling closure scope.
//
// 2) `dualMode`: a Jest `describe.each` wrapper that runs every assertion
//    in a section twice — once via `GET /[type]?<query>` and once via
//    `POST /[type]/_search` (form-encoded). Sections that use it pass in
//    the search dispatcher instead of calling `rest.search` directly.
//
// File starts with `_` so it doesn't get picked up as a Jest test file
// (jest.config.cjs `testMatch` excludes `_*.ts`).

import { describe } from "@jest/globals";
import type { Rest } from "../../interfaces/rest";

export const IDENT_SYSTEM = "http://fhir262/test";

export type BundleEntry = {
  resource: { id: string; resourceType: string };
  search?: { mode?: string };
};

export type Bundle = {
  resourceType: "Bundle";
  total?: number;
  entry?: BundleEntry[];
  link?: { relation: string; url: string }[];
};

export const idsOf = (b: unknown): string[] =>
  ((b as Bundle).entry ?? []).map((e) => e.resource.id);

// Bundle entries whose `search.mode` is "match" (the FHIR default — entries
// that satisfied the query, as opposed to `_include`d / `_revinclude`d
// sidecars).
export const matchEntries = (b: unknown): BundleEntry[] =>
  ((b as Bundle).entry ?? []).filter((e) => (e.search?.mode ?? "match") === "match");

export const matchIds = (b: unknown): string[] =>
  matchEntries(b).map((e) => e.resource.id);

export const includedEntries = (b: unknown): BundleEntry[] =>
  ((b as Bundle).entry ?? []).filter((e) => e.search?.mode === "include");

export const createOrFail = async (
  rest: Rest,
  type: string,
  resource: unknown,
): Promise<string> => {
  const res = await rest.create(type, resource);
  if (res.status !== 201) {
    throw new Error(
      `Expected: HTTP 201 (create ${type})\n` +
        `Received: HTTP ${res.status}\n` +
        `body: ${JSON.stringify(res.body, null, 2)}\n` +
        `resource: ${JSON.stringify(resource, null, 2)}`,
    );
  }
  const id = (res.body as { id?: string }).id;
  if (!id) {
    throw new Error(
      `Expected: response body to include an "id" field (create ${type})\n` +
        `Received: body without id\n` +
        `body: ${JSON.stringify(res.body, null, 2)}`,
    );
  }
  return id;
};

export const cleanup = async (rest: Rest, type: string, ids: string[]): Promise<void> => {
  for (const id of ids) await rest.delete(type, id);
};

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// Search dispatcher returned by `dualMode` — same signature as
// `Rest["search"]`, but routes through GET or POST depending on the
// currently-running parametrized describe block.
export type SearchFn = (
  resourceType: string,
  query?: string,
) => Promise<{ status: number; body: unknown }>;

// Run a section twice — once per HTTP search mode.
//
// Why a function: jest's `describe.each` table is evaluated at collection
// time, before `beforeAll` fires. The factory closes over a per-file
// `getInstance()` thunk that resolves the live `ServerInstance` at test
// execution time, so `rest.search` / `rest.searchPost` always bind to the
// instance booted by the file-level `beforeAll`.
//
// Usage (typical):
//
//   const rest = () => instance.rest;
//   dualMode("by-type-general", rest, (search) => {
//     beforeAll(async () => { ... seed ... });
//     it("token: ...", async () => {
//       const res = await search("Patient", "identifier=...");
//       expect(res).toHaveStatus(200);
//     });
//   });
export const dualMode = (
  label: string,
  getRest: () => Rest,
  define: (search: SearchFn) => void,
): void => {
  describe.each([{ name: "GET" as const }, { name: "POST" as const }])(
    `$name — ${label}`,
    ({ name }) => {
      const search: SearchFn = (t, q) =>
        name === "GET" ? getRest().search(t, q) : getRest().searchPost(t, q);
      define(search);
    },
  );
};
