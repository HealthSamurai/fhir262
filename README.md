# fhir262

A uniform FHIR server conformance test suite that runs against multiple
FHIR server implementations and produces a comparison report.

**Live conformance matrix: <https://healthsamurai.github.io/fhir262>**

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
make test-aidbox                                              # Aidbox (needs Docker + AIDBOX_LICENSE)
make test-hapi                                                # HAPI FHIR (needs Docker)
make test-medplum                                             # Medplum (needs Docker)
make test-msfhir                                              # Microsoft FHIR Server (needs Docker)
bun bin/run.ts -impl impl/aidbox/index.ts -out report.json    # write a JSON report
```

Aidbox needs `AIDBOX_LICENSE` in `.env` (see `.env.example`).

## Conformance matrix UI

The React UI under `ui/` renders a comparison matrix from a merged run
report. CI assembles `dist/` (UI + accumulated run history) and publishes
it to GitHub Pages.

```
make test-all     # produces .results/<impl>.json per impl
make ui-dist      # merges .results/ into dist/runs/run-<ts>.json + copies ui/
make ui-serve     # builds + serves dist/ on http://localhost:8000
```

`dist/runs/` accumulates one `run-<ts>.json` per build plus an
`index.json` listing all runs. The UI fetches the index, picks the
newest run, and lets you switch via the history popover (uses
`?run=<id>`). Re-running `make ui-dist` after a fresh test run adds a
new entry alongside the old ones.

CI (`.github/workflows/pages.yml`) restores `dist/runs/` from the
existing `gh-pages` branch before running `bin/build.ts`, so history
persists across deploys.

