const fs = require("node:fs");
const path = require("node:path");

class Fhir262Reporter {
  constructor() {
    this.outPath = process.env.FHIR262_OUT_PATH;
    this.implName = process.env.FHIR262_IMPL_NAME ?? "unknown";
    this.startedAt = new Date().toISOString();
    this.t0 = Date.now();
    this.results = [];
  }
  onTestCaseResult(_test, tc) {
    this.results.push({
      id: [...tc.ancestorTitles, tc.title].join(" > "),
      status:
        tc.status === "passed"
          ? "pass"
          : tc.status === "skipped" || tc.status === "pending" || tc.status === "todo"
            ? "skipped"
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

module.exports = Fhir262Reporter;
