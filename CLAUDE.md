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
make test-aidbox                                              # run against Aidbox (Docker, needs AIDBOX_LICENSE)
bun bin/run.ts -impl impl/aidbox/index.ts                     # equivalent of test-aidbox
bun bin/run.ts -impl impl/aidbox/index.ts -out report.json    # also write a JSON report
```

`-out` is optional. Without it, jest's console output is the only result;
with it, `framework/reporter.cjs` writes a JSON report.

The Aidbox impl needs `AIDBOX_LICENSE` set in `.env` (gitignored; see
`.env.example`). Docker must be running — the impl spins up a single
postgres + aidboxone pair once per run (in jest's globalSetup) via testcontainers.

## Layout

```
fhir262/
├── bin/run.ts                  # CLI entry (Bun): parses flags, spawns jest with env
├── jest.config.cjs             # jest + ts-jest config; uses custom reporter
├── Makefile                    # convenience targets (test-aidbox, ...)
│
├── tests/                      # the canonical suite (the product)
│   └── <area>/<name>.ts        # any .ts under tests/ is a test file
│                               # e.g. tests/validation/simple-cases-test.ts
│
├── impl/                       # FHIR server implementations
│   ├── aidbox/index.ts         # postgres + aidboxone via testcontainers
│   ├── hapi/index.ts           # HAPI FHIR server via testcontainers
│   ├── medplum/index.ts        # Medplum via testcontainers
│   └── msfhir/index.ts         # Microsoft FHIR Server via testcontainers
│
├── interfaces/                 # pure FHIR-shaped contracts — no implementation code
│   ├── server.ts               # Server, ServerSpec, ServerConnection
│   └── rest.ts                 # Rest
│
├── framework/                  # plumbing
│   ├── impl-loader.ts          # loadImpl(): returns the `impl` map from the file given to -impl
│   ├── global-setup.ts         # jest globalSetup → Server.prepare() (provision once per run)
│   ├── global-teardown.ts      # jest globalTeardown → Server.teardown()
│   ├── log.ts                  # createLogger(name), since(t0) — shared logging helpers for impls
│   └── reporter.cjs            # custom jest reporter; writes JSON report to FHIR262_OUT_PATH
│
├── .plans/                     # design plans (hidden — local design notes, still tracked)
└── .results/                   # gitignored local outputs
```

## Test shape

A test opens a connection to the already-prepared server in `beforeAll` and uses `connection.rest`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { ServerConnection } from "../../../interfaces/server";
import { loadImpl } from "../../../framework/impl-loader";

const server = loadImpl().server;
let connection: ServerConnection;

beforeAll(async () => { connection = await server.connect({ fhirVersion: "r4" }); });
afterAll(async () => { await connection.close(); });

describe("validate-patient", () => {
  it("validates a minimal Patient with no errors", async () => {
    const res = await connection.rest.operation("Patient", "$validate", {
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
a typed map of interfaces (`{ server, ... }`). The server is provisioned
once per run in jest's globalSetup (`Server.prepare`); each test file's
`beforeAll` only opens a cheap client via `Server.connect`, and `rest` comes
from the returned `ServerConnection`.

FHIR's `OperationOutcome.issue` cardinality is `1..*` — a successful validate
returns at least one informational issue. Assertions should check for the
absence of `error`/`fatal` severities, not for an empty `issue` array.

## Conventions

- Each impl is a single TS file exporting `impl` (a map of interfaces). Layout is free — `-impl` points at the file directly. The impl name shown in reports is the parent directory name when the file is `index.ts`, otherwise the filename minus extension.
- TS interface names: no `I` prefix.
- The server is provisioned once per run in globalSetup; `beforeAll` just opens a cheap connection via `connect()`. Because every file shares that one server, **each test must clean up the resources it creates**; the suite runs serially (`maxWorkers: 1`), so leftover data would otherwise pollute later files. Keep related assertions for the same feature in one file as additional `it()` blocks so they share setup and a single connection.
- Impls log lifecycle and request activity through `framework/log.ts` (`createLogger("<impl-name>")`); output goes to stderr so it appears live during a run.

## House rules

- Don't commit without explicit request.
- Don't add "Generated with Claude Code" attribution to commit messages.
- Commit messages: short one-line subject only, no body. Focus the subject on the headline change; supporting infra/refactors don't need to be mentioned.
