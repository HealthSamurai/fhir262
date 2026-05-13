// Custom Jest matchers for FHIR validation outcomes.
//
// Wired in via `setupFilesAfterEnv` in jest.config.cjs. Because matchers run
// via expect.extend, Jest captures the stack at the `expect(x).toXxx()` call
// site — code frames point at the test line, not at this file.

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
    const issues = issuesOf(received);
    const failures = issues.filter(isErrorIssue);
    const pass = failures.length === 0;
    return {
      pass,
      message: () => {
        const hint = this.utils.matcherHint(
          "toBeValid",
          "received",
          "",
          { isNot: this.isNot }
        );
        return [
          hint,
          "",
          `Expected: no issues with severity ${this.utils.printExpected("error")} or ${this.utils.printExpected("fatal")}`,
          `Received: ${this.utils.printReceived(failures)}`,
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
        const hint = this.utils.matcherHint(
          "toBeInvalid",
          "received",
          "",
          { isNot: this.isNot }
        );
        return [
          hint,
          "",
          `Expected: at least one issue with severity ${this.utils.printExpected("error")} or ${this.utils.printExpected("fatal")}`,
          `Received: ${this.utils.printReceived(issues)}`,
        ].join("\n");
      },
    };
  },

  toHaveIssueAt(received: Response, expression: string) {
    const issues = issuesOf(received);
    const expressions = issues.flatMap((i) => i.expression ?? []);
    const pass = expressions.includes(expression);
    return {
      pass,
      message: () => {
        const hint = this.utils.matcherHint(
          "toHaveIssueAt",
          "received",
          "expression",
          { isNot: this.isNot }
        );
        return [
          hint,
          "",
          `Expected: an issue with expression ${this.utils.printExpected(expression)}`,
          `Received: ${this.utils.printReceived(expressions)}`,
        ].join("\n");
      },
    };
  },
});

declare module "expect" {
  interface AsymmetricMatchers {
    toBeValid(): void;
    toBeInvalid(): void;
    toHaveIssueAt(expression: string): void;
  }
  interface Matchers<R> {
    toBeValid(): R;
    toBeInvalid(): R;
    toHaveIssueAt(expression: string): R;
  }
}
