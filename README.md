# fhir262

A uniform FHIR server conformance test suite that runs against multiple FHIR
server implementations and produces a comparison report.

## Why "fhir262"?

The name pays homage to [tc39/test262](https://github.com/tc39/test262) — the
ECMAScript language's canonical conformance test suite. The same model fits
the FHIR server world: one growing, community-owned set of tests that
multiple implementations run against, with the results published in a
public matrix.

Where test262 produces JavaScript engine conformance results across V8,
SpiderMonkey, JavaScriptCore, and friends, fhir262 produces the same kind
of cross-implementation comparison for FHIR servers — HAPI FHIR, Aidbox,
Medplum, Firely, and others.

## Quick start

```
make test-stub                                                # run against the bundled stub impl
make test-aidbox                                              # run against Aidbox (needs Docker + AIDBOX_LICENSE)
bun bin/run.ts -impl impl/stub/index.ts -out report.json      # write a JSON report
```

The Aidbox runner expects `AIDBOX_LICENSE` in a local `.env` file (see
`.env.example`); it spins up a fresh postgres + aidboxone pair per test
file via [testcontainers](https://node.testcontainers.org/).

For codebase layout and how to write tests / add an impl, see
[CLAUDE.md](./CLAUDE.md). Design plans live under [plans/](./plans/).
