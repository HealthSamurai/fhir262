const fs = require("node:fs");
const path = require("node:path");
const {
  getStackTraceLines,
  getTopFrame,
  separateMessageFromStack,
} = require("jest-message-util");

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s) => (s ?? "").replace(ANSI_RE, "");

// 2 lines above, 3 below — matches @babel/code-frame defaults that jest itself uses.
const FRAME_BEFORE = 2;
const FRAME_AFTER = 3;

function buildCodeFrame(stackOnly, rootDir) {
  if (!stackOnly) return null;
  const top = getTopFrame(getStackTraceLines(stackOnly));
  if (!top || !top.file || top.file.includes("node_modules")) return null;
  const abs = path.isAbsolute(top.file) ? top.file : path.join(rootDir, top.file);
  if (!abs.startsWith(rootDir + path.sep)) return null;
  if (!fs.existsSync(abs)) return null;
  const src = fs.readFileSync(abs, "utf8").split(/\r?\n/);
  const start = Math.max(1, top.line - FRAME_BEFORE);
  const end = Math.min(src.length, top.line + FRAME_AFTER);
  const lines = [];
  for (let i = start; i <= end; i++) lines.push({ number: i, text: src[i - 1] ?? "" });
  return {
    file: path.relative(rootDir, abs),
    line: top.line,
    col: top.column,
    lines,
  };
}

function parseFailure(failureDetail, failureMessages, rootDir) {
  const err = failureDetail || {};
  const fullStack = err.stack || (failureMessages && failureMessages[0]) || "";
  // jest-message-util splits the error block into the human message (the part
  // before the first `at <frame>` line) and the stack frames themselves.
  const { message: rawMessage, stack: stackOnly } = separateMessageFromStack(fullStack);
  const matcherMessage =
    (err.matcherResult && err.matcherResult.message) || err.message || rawMessage;

  const msgLines = stripAnsi(matcherMessage).replace(/\r\n/g, "\n").split("\n");
  const firstNonEmpty = msgLines.find((l) => l.trim());
  const assertionLine =
    msgLines.find((l) => l.trim().startsWith("expect(")) || firstNonEmpty || "";
  const expectedLine = msgLines.find((l) => l.startsWith("Expected:"));
  // Received: may span multiple lines (matchers like toHaveIssueWithExpression
  // pretty-print a JSON body below the prefix), so we collect from the prefix
  // line to the end of the message rather than grabbing a single line.
  const receivedIdx = msgLines.findIndex((l) => l.startsWith("Received:"));
  const receivedBlock =
    receivedIdx === -1
      ? ""
      : [
          msgLines[receivedIdx].slice("Received:".length),
          ...msgLines.slice(receivedIdx + 1),
        ]
          .join("\n")
          .trim();

  const rootPrefix = rootDir + path.sep;
  const stack = getStackTraceLines(stackOnly)
    .map((l) => stripAnsi(l).trim())
    .filter(Boolean)
    .map((l) => l.split(rootPrefix).join(""));

  return {
    assertion: assertionLine.trim(),
    expected: expectedLine ? expectedLine.slice("Expected:".length).trim() : "",
    received: receivedBlock,
    stack,
    codeFrame: buildCodeFrame(stackOnly, rootDir) || undefined,
  };
}

class Fhir262Reporter {
  constructor() {
    this.outPath = process.env.FHIR262_OUT_PATH;
    this.implName = process.env.FHIR262_IMPL_NAME ?? "unknown";
    this.startedAt = new Date().toISOString();
    this.t0 = Date.now();
    this.rootDir = process.cwd();
    this.results = [];
  }
  onTestCaseResult(test, tc) {
    const status =
      tc.status === "passed"
        ? "pass"
        : tc.status === "skipped" || tc.status === "pending" || tc.status === "todo"
          ? "skipped"
          : "fail";
    const result = {
      id: [...tc.ancestorTitles, tc.title].join(" > "),
      file: path.relative(this.rootDir, test.path),
      line: tc.location?.line,
      status,
      duration_ms: tc.duration ?? 0,
    };
    if (status === "fail") {
      result.error = parseFailure(
        tc.failureDetails && tc.failureDetails[0],
        tc.failureMessages,
        this.rootDir
      );
    }
    this.results.push(result);
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
