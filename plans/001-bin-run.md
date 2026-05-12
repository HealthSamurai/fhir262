# Plan — first runnable `bin/run` (jest-based)

## Context

confhir's first vertical slice: a CLI that loads one FHIR server implementation, runs the conformance test suite against it, and writes a JSON result report. Invocation:

```
bun bin/run.ts -impl impl/stub -out .results/today/outcome.json
```

This wires the four layers in CLAUDE.md (`framework/`, `interfaces/`, `impl/`, `tests/`) end-to-end. After this, we have a working harness, a one-test suite, and the stub returning canned `OperationOutcome` — enough to demo the mechanism and add real impls later.

**Test runner**: jest (per user choice), with a custom reporter that emits our JSON schema. `bin/run.ts` runs under Bun and spawns jest as a subprocess.

## Architecture

- **`bin/run.ts` (Bun)** — parses `-impl <dir>` and `-out <path>`; spawns jest with environment `CONFHIR_IMPL_DIR`, `CONFHIR_IMPL_NAME`, `CONFHIR_OUT_PATH`. Jest's exit code surfaces test success/failure; the JSON report is always written.
- **jest** — discovers and runs `tests/**/test.ts`. Configured via `jest.config.cjs`. Uses **ts-jest** preset for TS support. Tests use jest globals.
- **`framework/reporter.cjs`** — custom jest reporter (class with `onTestCaseResult` and `onRunComplete` hooks). On run completion, writes the `RunReport` JSON to `CONFHIR_OUT_PATH`.
- **`framework/jest-helpers.ts`** — used by tests to load impl interfaces:
  - `loadImpl(): Impl` — `require(implDir/impl.ts)` once, cache
  - `loadInterface<T>(name: string): T` — `require(implDir/<name>.ts)`
  - `hasCapability(...names): boolean` — for `describe.skip` gating
- **Tests** — jest globals (`describe`/`it`/`expect`); access impl interfaces via `loadInterface<Rest>("rest")`; gate via `hasCapability("rest")`.

### Why CJS, not ESM

`ts-jest`'s CJS path is the smooth default (one preset, no `--experimental-vm-modules`). Helpers use `require(...)` of TS files which `ts-jest` handles transparently. Moving to ESM later is a config change if/when needed.

### Why the Bun ↔ jest boundary is OK

`bin/run.ts` is small (arg parsing + spawn + summary). Jest runs in its own process. The boundary is one `child_process.spawn` call — fine. If keeping jest under Bun ends up rough, switch the subprocess to `npx jest` (Node).

## Files

### Create

**`jest.config.cjs`**:

```js
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/test.ts"],
  reporters: ["default", "<rootDir>/framework/reporter.cjs"],
  rootDir: ".",
};
```

**`framework/reporter.cjs`** — custom jest reporter:

```js
const fs = require("node:fs");
const path = require("node:path");

class ConfhirReporter {
  constructor() {
    this.outPath = process.env.CONFHIR_OUT_PATH;
    this.implName = process.env.CONFHIR_IMPL_NAME ?? "unknown";
    this.startedAt = new Date().toISOString();
    this.t0 = Date.now();
    this.results = [];
  }
  onTestCaseResult(_test, tc) {
    this.results.push({
      id: [...tc.ancestorTitles, tc.title].join(" > "),
      status:
        tc.status === "passed" ? "pass"
        : tc.status === "skipped" || tc.status === "pending" || tc.status === "todo" ? "skipped"
        : "fail",
      duration_ms: tc.duration ?? 0,
      error: tc.failureMessages?.length ? tc.failureMessages.join("\n") : undefined,
    });
  }
  onRunComplete() {
    if (!this.outPath) return;
    const report = {
      impl: this.implName,
      startedAt: this.startedAt,
      duration_ms: Date.now() - this.t0,
      results: this.results,
    };
    fs.mkdirSync(path.dirname(this.outPath), { recursive: true });
    fs.writeFileSync(this.outPath, JSON.stringify(report, null, 2) + "\n");
  }
}

module.exports = ConfhirReporter;
```

**`framework/result.ts`** — shared TS types (also useful for later dashboard tooling):

```ts
export type TestStatus = "pass" | "fail" | "skipped";

export interface TestResult {
  id: string;
  status: TestStatus;
  duration_ms: number;
  error?: string;
}

export interface RunReport {
  impl: string;
  startedAt: string;
  duration_ms: number;
  results: TestResult[];
}
```

**`framework/jest-helpers.ts`** — impl access from tests:

```ts
import type { Impl } from "./impl";
import path from "node:path";

function implDir(): string {
  const dir = process.env.CONFHIR_IMPL_DIR;
  if (!dir) throw new Error("CONFHIR_IMPL_DIR not set");
  return path.resolve(dir);
}

let cachedImpl: Impl | null = null;

export function loadImpl(): Impl {
  if (cachedImpl) return cachedImpl;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(path.resolve(implDir(), "impl.ts"));
  cachedImpl = mod.impl as Impl;
  return cachedImpl;
}

export function loadInterface<T>(name: string): T {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(path.resolve(implDir(), `${name}.ts`));
  return mod[name] as T;
}

export function hasCapability(...names: string[]): boolean {
  const impl = loadImpl();
  return names.every((n) => impl.capabilities.includes(n));
}
```

**`tests/conformance/validate-patient/test.ts`** — first test:

```ts
import { describe, it, expect } from "@jest/globals";
import patient from "./patient.json";
import type { Rest } from "../../../interfaces/rest";
import { loadInterface, hasCapability } from "../../../framework/jest-helpers";

const d = hasCapability("rest") ? describe : describe.skip;

d("conformance.validate-patient", () => {
  const rest = loadInterface<Rest>("rest");

  it("validates a minimal Patient with no issues", async () => {
    const res = await rest.typeOperation({
      type: "Patient",
      operation: "validate",
      body: patient,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      resourceType: "OperationOutcome",
      issue: [],
    });
  });
});
```

**`bin/run.ts`** — CLI entry (runs under Bun):

```ts
#!/usr/bin/env bun
import { spawn } from "node:child_process";
import path from "node:path";

function parseArgs(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("-")) flags[a.replace(/^-+/, "")] = argv[++i];
  }
  return flags;
}

const flags = parseArgs(process.argv.slice(2));
const implDir = flags["impl"];
const outPath = flags["out"];

if (!implDir || !outPath) {
  console.error("Usage: bun bin/run.ts -impl <impl/dir> -out <result.json>");
  process.exit(1);
}

const exitCode = await new Promise<number>((resolve) => {
  const child = spawn("npx", ["jest", "--config=jest.config.cjs"], {
    stdio: "inherit",
    env: {
      ...process.env,
      CONFHIR_IMPL_DIR: path.resolve(implDir),
      CONFHIR_IMPL_NAME: path.basename(implDir),
      CONFHIR_OUT_PATH: path.resolve(outPath),
    },
  });
  child.on("exit", (code) => resolve(code ?? 1));
});

console.log(`Wrote ${outPath}`);
process.exit(exitCode);
```

### Modify

**`impl/stub/impl.ts`** — rename export `stub` → `impl` (directory convention: filename matches export name):

```ts
import type { Impl } from "../../framework/impl";

export const impl: Impl = {
  name: "stub",
  capabilities: ["rest"],
  async start() {},
  async stop() {},
};
```

**`impl/stub/rest.ts`** — rename export `stubRest` → `rest`:

```ts
import type { Rest } from "../../interfaces/rest";

export const rest: Rest = {
  async typeOperation() {
    return {
      status: 200,
      body: { resourceType: "OperationOutcome", issue: [] },
    };
  },
};
```

**`tsconfig.json`** — switch to CJS for ts-jest compatibility, add `resolveJsonModule`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

**`package.json`** — add jest deps; remove ESM marker so CJS works simply:

```json
{
  "name": "confhir",
  "version": "0.0.0",
  "private": true,
  "devDependencies": {
    "@types/jest": "^29",
    "@types/node": "^22",
    "jest": "^29",
    "ts-jest": "^29",
    "typescript": "^5"
  }
}
```

### Not touched

- `interfaces/rest.ts`, `framework/impl.ts`, `tests/conformance/validate-patient/patient.json`, `.gitignore`, `CLAUDE.md`.
- `framework/context.ts` and `framework/runner.ts` are **not** created. Jest replaces them. CLAUDE.md will need a small follow-up update once committed.
- `src/testexample.ts` — leftover; leave it.

## Verification

1. From the repo root: `npm install` (or `bun install` — either resolves the npm registry deps).
2. Run:
   ```
   bun bin/run.ts -impl impl/stub -out .results/today/outcome.json
   ```
3. Expected stdout: jest reports 1 passing test, then `Wrote .results/today/outcome.json`.
4. Expected file `.results/today/outcome.json`:
   ```json
   {
     "impl": "stub",
     "startedAt": "2026-05-12T...",
     "duration_ms": <n>,
     "results": [
       {
         "id": "conformance.validate-patient > validates a minimal Patient with no issues",
         "status": "pass",
         "duration_ms": <n>
       }
     ]
   }
   ```
5. **Skip sanity check**: temporarily remove `"rest"` from `impl/stub/impl.ts`'s `capabilities`, rerun; expect the describe block reported as skipped in jest and as `"status": "skipped"` entries in the JSON. Revert.
6. **Fail sanity check**: temporarily change stub response to `{ issue: [{}] }`, rerun; expect 1 failure in jest output and a `"status": "fail"` entry with the assertion failure in the `error` field. Revert.

## Tradeoffs and notes

- **bun ↔ jest boundary**: `bin/run.ts` (Bun) → `npx jest` (Node via npx). One subprocess. If problems arise, swap `npx` for `bunx`.
- **CJS over ESM**: `ts-jest`'s CJS path requires no flags or experimental modes. The helpers can `require(path)` TS files cleanly.
- **Capability cohort granularity**: describe-level skipping for now (`describe.skip`). For per-`it` granularity later, we can introduce a wrapper or `it.skip` based on smaller capability sets.
- **Single-impl run**: this command targets one impl. Multi-impl matrix builds on top: a script that loops over impl dirs invoking `bin/run.ts` and aggregates the per-impl JSONs into a matrix.

## Out of scope (next iterations)

- Multi-impl matrix aggregation.
- Dashboard / static site build.
- Real impl (HAPI, Aidbox) with docker lifecycle.
- Captured request/response payloads in the report (we can add later by recording calls inside `rest.ts` impls or via jest custom matchers).
- ESM migration if/when we need top-level await or modern ESM features in tests.
