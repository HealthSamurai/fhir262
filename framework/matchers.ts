// Custom Jest matchers for FHIR validation outcomes.
//
// Wired in via `setupFilesAfterEnv` in jest.config.cjs. Because matchers run
// via expect.extend, Jest captures the stack at the `expect(x).toXxx()` call
// site — code frames point at the test line, not at this file.
//
// Message format convention — REQUIRED for the UI report (ui/app.jsx) to render
// failures. `framework/reporter.cjs` parses the message string with literal
// `startsWith("Expected:")` and `startsWith("Received:")` checks (see
// parseFailure). Lines that don't start with those exact prefixes are dropped
// from the report payload, so the UI shows empty Expected/Received fields.
//
// Rules for the message() string returned below:
//   - Exactly one line begins with `Expected: ` (colon + space, no word before).
//   - Exactly one line begins with `Received: ` — everything from that line to
//     end-of-message becomes the Received block (the UI renders it multi-line),
//     so JSON bodies / continuations belong here.
//   - Don't introduce sibling labels like `Body:` or `Status:` as line prefixes
//     for content you want displayed — they will be silently dropped by the
//     reporter. Put that content inside the Received block instead.

import { expect } from "@jest/globals";

type Severity = "fatal" | "error" | "warning" | "information";

interface Issue {
  severity: Severity;
  code?: string;
  details?: { text?: string };
  diagnostics?: string;
  expression?: string[];
}

interface OperationOutcome {
  resourceType: "OperationOutcome";
  issue?: Issue[];
}

interface Response {
  status: number;
  body: unknown;
}

const isErrorIssue = (i: Issue) => i.severity === "error" || i.severity === "fatal";

function issuesOf(res: unknown): Issue[] {
  const body = (res as Response | undefined)?.body as OperationOutcome | undefined;
  if (!body || body.resourceType !== "OperationOutcome") return [];
  return body.issue ?? [];
}

expect.extend({
  toBeValid(received: Response) {
    const status = received?.status;
    const statusOk = typeof status === "number" && status >= 200 && status < 300;
    const issues = issuesOf(received);
    const failures = issues.filter(isErrorIssue);
    const pass = statusOk && failures.length === 0;
    return {
      pass,
      message: () => {
        const hint = this.utils.matcherHint("toBeValid", "received", "", { isNot: this.isNot });
        return [
          hint,
          "",
          `Expected: status in ${this.utils.printExpected("[200, 300)")} and no issues with severity ${this.utils.printExpected("error")} or ${this.utils.printExpected("fatal")}`,
          `Received: status ${this.utils.printReceived(status)}, issues ${this.utils.printReceived(failures)}`,
        ].join("\n");
      },
    };
  },

  toBeInvalid(received: Response) {
    const issues = issuesOf(received);
    const failures = issues.filter(isErrorIssue);
    const pass = failures.length > 0;
    return {
      pass,
      message: () => {
        const hint = this.utils.matcherHint("toBeInvalid", "received", "", { isNot: this.isNot });
        return [
          hint,
          "",
          `Expected: at least one issue with severity ${this.utils.printExpected("error")} or ${this.utils.printExpected("fatal")}`,
          `Received: ${this.utils.printReceived(issues)}`,
        ].join("\n");
      },
    };
  },

  toHaveStatus(received: Response, expected: number) {
    const status = received?.status;
    const pass = status === expected;
    return {
      pass,
      message: () => {
        const hint = this.utils.matcherHint("toHaveStatus", "received", "expected", {
          isNot: this.isNot,
        });
        return [
          hint,
          "",
          `Expected: ${this.utils.printExpected(expected)}`,
          `Received: ${this.utils.printReceived(status)}`,
          `body:\n${JSON.stringify(received?.body, null, 2)}`,
        ].join("\n");
      },
    };
  },

  toHaveIssueWithExpression(received: Response, expression: string) {
    const issues = issuesOf(received);
    const expressions = issues.flatMap((i) => i.expression ?? []);
    const pass = expressions.includes(expression);
    return {
      pass,
      message: () => {
        const hint = this.utils.matcherHint("toHaveIssueWithExpression", "received", "expression", {
          isNot: this.isNot,
        });
        return [
          hint,
          "",
          `Expected: an issue with expression ${this.utils.printExpected(expression)}`,
          `Received:\n${JSON.stringify(received, null, 2)}`,
        ].join("\n");
      },
    };
  },
});

declare module "expect" {
  interface AsymmetricMatchers {
    toBeValid(): void;
    toBeInvalid(): void;
    toHaveStatus(expected: number): void;
    toHaveIssueWithExpression(expression: string): void;
  }
  interface Matchers<R> {
    toBeValid(): R;
    toBeInvalid(): R;
    toHaveStatus(expected: number): R;
    toHaveIssueWithExpression(expression: string): R;
  }
}
