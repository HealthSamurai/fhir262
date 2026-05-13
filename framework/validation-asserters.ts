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

const issuesOf = (res: Response): Issue[] => {
  expect(res.body).toMatchObject({ resourceType: "OperationOutcome" });
  return (res.body as OperationOutcome).issue ?? [];
};

const isInvalid = (i: Issue) => i.severity === "error" || i.severity === "fatal";

export const expectValid = (res: Response): void => {
  const invalid = issuesOf(res).filter(isInvalid);
  expect(invalid).toEqual([]);
};

export const expectInvalid = (res: Response): void => {
  const all = issuesOf(res);
  expect(all.some(isInvalid)).toBe(true);
};

export const expectOnlyOneInvalid = (res: Response): void => {
  const invalid = issuesOf(res).filter(isInvalid);
  expect(invalid).toHaveLength(1);
};

export const expectIssueExpression = (res: Response, expression: string): Issue => {
  const all = issuesOf(res);
  const expressions = all.flatMap((i) => i.expression ?? []);
  expect(expressions).toContain(expression);
  return all.find((i) => i.expression?.includes(expression))!;
};
