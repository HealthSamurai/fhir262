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
bun bin/run.ts -impl impl/stub/index.ts                       # equivalent
bun bin/run.ts -impl impl/stub/index.ts -out report.json      # also write a JSON report
```

`-out` is optional. Without it, jest's console output is the only result;
with it, `framework/reporter.cjs` writes a JSON report.

## Layout

```
fhir262/
├── bin/run.ts                  # CLI entry (Bun): parses flags, spawns jest with env
├── jest.config.cjs             # jest + ts-jest config; uses custom reporter
├── Makefile                    # convenience targets (test-stub, ...)
│
├── tests/                      # the canonical suite (the product)
│   └── conformance/<name>/test.ts
│
├── impl/                       # FHIR server implementations
│   └── stub/
│       └── index.ts            # exports `impl`: { server, ... } — pointed at via -impl
│
├── interfaces/                 # pure FHIR-shaped contracts — no implementation code
│   ├── server.ts               # Server, ServerInstance
│   └── rest.ts                 # Rest
│
├── framework/                  # plumbing
│   ├── impl-loader.ts          # loadImpl(): returns the `impl` map from the file given to -impl
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

describe("conformance.validate-patient", () => {
  it("validates a Patient with no issues", async () => {
    const res = await instance.rest.operation("Patient", "validate", {
      resourceType: "Patient", id: "example",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ resourceType: "OperationOutcome", issue: [] });
  });
});
```

`loadImpl()` reads `FHIR262_IMPL_PATH` from env (set by `bin/run.ts` from
the `-impl` flag), `require`s that file, and returns its `impl` export —
a typed map of interfaces (`{ server, ... }`). The `Server` interface is
the entry point for tests; `rest` comes from the started `ServerInstance`.

## Conventions

- Each impl is a single TS file exporting `impl` (a map of interfaces). Layout is free — `-impl` points at the file directly. The impl name shown in reports is the parent directory name when the file is `index.ts`, otherwise the filename minus extension.
- TS interface names: no `I` prefix.
- Stub returns canned data — no real HTTP server.

## House rules

- Don't commit without explicit request.
- Don't add "Generated with Claude Code" attribution to commit messages.
