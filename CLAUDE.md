# fhir262 — FHIR server conformance tests

A uniform conformance test suite that runs against multiple FHIR server
implementations and produces a comparison report. Named in homage to
[tc39/test262](https://github.com/tc39/test262) — same model: one growing
suite, multiple implementations, comparison output.

## Stack

- TypeScript + Bun for the CLI runner
- jest (+ ts-jest) as the test runner; custom reporter emits a JSON report

## Run

```
make test-stub                                                # run the suite against the stub impl
make test-aidbox                                              # run against Aidbox (Docker, needs AIDBOX_LICENSE)
bun bin/run.ts -impl impl/stub/index.ts                       # equivalent of test-stub
bun bin/run.ts -impl impl/stub/index.ts -out report.json      # also write a JSON report
```

`-out` is optional. Without it, jest's console output is the only result;
with it, `framework/reporter.cjs` writes a JSON report.

The Aidbox impl needs `AIDBOX_LICENSE` set in `.env` (gitignored; see
`.env.example`). Docker must be running — the impl spins up a fresh
postgres + aidboxone pair per test file via testcontainers.

## Layout

```
fhir262/
├── bin/run.ts                  # CLI entry (Bun): parses flags, spawns jest with env
├── jest.config.cjs             # jest + ts-jest config; uses custom reporter
├── Makefile                    # convenience targets (test-stub, ...)
│
├── tests/                      # the canonical suite (the product)
│   └── <area>/<name>/test.ts   # e.g. tests/validation/validate-patient/test.ts
│
├── impl/                       # FHIR server implementations
│   ├── stub/index.ts           # returns canned data; no container
│   └── aidbox/index.ts         # postgres + aidboxone via testcontainers
│
├── interfaces/                 # pure FHIR-shaped contracts — no implementation code
│   ├── server.ts               # Server, ServerInstance
│   └── rest.ts                 # Rest
│
├── framework/                  # plumbing
│   ├── impl-loader.ts          # loadImpl(): returns the `impl` map from the file given to -impl
│   ├── log.ts                  # createLogger(name), since(t0) — shared logging helpers for impls
│   └── reporter.cjs            # custom jest reporter; writes JSON report to FHIR262_OUT_PATH
│
├── plans/                      # design plans
└── .results/                   # gitignored local outputs
```

## Test shape

A test loads the server, manages its lifecycle, and uses `instance.rest`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { ServerInstance } from "../../../interfaces/server";
import { loadImpl } from "../../../framework/impl-loader";

const server = loadImpl().server;
let instance: ServerInstance;

beforeAll(async () => { instance = await server.startWithCoreOnly("r4"); });
afterAll(async () => { await instance.stop(); });

describe("validate-patient", () => {
  it("validates a minimal Patient with no errors", async () => {
    const res = await instance.rest.operation("Patient", "validate", {
      resourceType: "Patient", id: "example",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ resourceType: "OperationOutcome" });
    const issues = (res.body as { issue?: { severity: string }[] }).issue ?? [];
    expect(issues.some((i) => i.severity === "error" || i.severity === "fatal")).toBe(false);
  });
});
```

`loadImpl()` reads `FHIR262_IMPL_PATH` from env (set by `bin/run.ts` from
the `-impl` flag), `require`s that file, and returns its `impl` export —
a typed map of interfaces (`{ server, ... }`). The `Server` interface is
the entry point for tests; `rest` comes from the started `ServerInstance`.

FHIR's `OperationOutcome.issue` cardinality is `1..*` — a successful validate
returns at least one informational issue. Assertions should check for the
absence of `error`/`fatal` severities, not for an empty `issue` array.

## Conventions

- Each impl is a single TS file exporting `impl` (a map of interfaces). Layout is free — `-impl` points at the file directly. The impl name shown in reports is the parent directory name when the file is `index.ts`, otherwise the filename minus extension.
- TS interface names: no `I` prefix.
- Stub returns canned data — no real HTTP server.
- Each test file boots a fresh server environment in `beforeAll`. For real impls (e.g. Aidbox) that's ~20s per file, so related assertions for the same feature go in one `test.ts` as additional `it()` blocks rather than in sibling folders.
- Impls log lifecycle and request activity through `framework/log.ts` (`createLogger("<impl-name>")`); output goes to stderr so it appears live during a run.

## House rules

- Don't commit without explicit request.
- Don't add "Generated with Claude Code" attribution to commit messages.
