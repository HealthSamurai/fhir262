# fhir262

A uniform FHIR server conformance test suite that runs against multiple
FHIR server implementations and produces a comparison report.

The name nods to [tc39/test262](https://github.com/tc39/test262): one
growing suite, multiple implementations, comparison output.

## How it works

Tests are written against a small set of FHIR-shaped TypeScript
interfaces — not against any specific server. Each server provides an
adapter that implements those interfaces however it likes (containers,
hosted API, canned data). The same test runs unchanged against every
impl; swapping impls is a CLI flag.

Four components:

- `interfaces/` — FHIR-shaped TypeScript contracts. No code.
- `tests/` — the conformance suite. Depends only on `interfaces/`.
- `framework/` — plumbing: impl loader, logger, jest reporter.
- `impl/<name>/` — one server's adapter. Adding a server = adding a folder here.

## Quick start

```
make test-stub                                                # bundled stub impl
make test-aidbox                                              # Aidbox (needs Docker + AIDBOX_LICENSE)
make test-medplum                                             # Medplum (needs Docker)
bun bin/run.ts -impl impl/stub/index.ts -out report.json      # write a JSON report
```

Aidbox needs `AIDBOX_LICENSE` in `.env` (see `.env.example`).

