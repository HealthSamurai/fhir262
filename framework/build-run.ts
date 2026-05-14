// Merges per-impl test reports (the .json files written by framework/reporter.cjs)
// into a single run JSON that the UI consumes. See ui/loader.js for the shape.

export type CodeFrameLine = { number: number; text: string };
export type CodeFrame = {
  file: string;
  line: number;
  col: number;
  lines: CodeFrameLine[];
};

export type CellError = {
  assertion: string;
  expected: string;
  received: string;
  stack: string[];
  codeFrame?: CodeFrame;
};

export type ImplReportResult = {
  id: string;
  file: string;
  line?: number;
  status: "pass" | "fail" | "skipped";
  duration_ms: number;
  error?: CellError;
};

export type ImplReport = {
  impl: string;
  startedAt: string;
  duration_ms: number;
  results: ImplReportResult[];
};

export type RunMeta = {
  id: string;
  startedAt: string;
  duration_ms: number;
  commit: string;
  commitMessage: string;
  branch: string;
  suiteVersion: string;
  repoUrl: string;
};

export type Impl = { id: string; label: string };
export type ModuleTest = {
  id: string;
  title: string;
  fullName: string;
  file: string;
  line?: number;
};
export type Module = { id: string; label: string; tests: ModuleTest[] };

export type Cell = {
  status: "pass" | "fail" | "skipped";
  duration_ms?: number;
  error?: CellError;
};

export type Statuses = Record<string, Record<string, Record<string, Cell>>>;

export type Run = {
  meta: RunMeta;
  impls: Impl[];
  modules: Module[];
  statuses: Statuses;
};

export type IndexEntry = {
  id: string;
  startedAt: string;
  duration_ms: number;
  commit: string;
  commitMessage: string;
  branch: string;
  impls: string[];
  pass: number;
  fail: number;
  skipped: number;
};

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const moduleIdFromFile = (file: string) => file.split("/")[1]; // tests/<module>/...
const titleFromId = (id: string) => id.split(" > ").at(-1) ?? id;
const testKey = (file: string, id: string) => `${file}::${id}`;

function buildModules(reports: ImplReport[]): Module[] {
  const buckets = new Map<string, Map<string, { test: ModuleTest; line: number }>>();
  for (const r of reports) {
    for (const result of r.results) {
      const modId = moduleIdFromFile(result.file);
      const key = testKey(result.file, result.id);
      let bucket = buckets.get(modId);
      if (!bucket) buckets.set(modId, (bucket = new Map()));
      if (!bucket.has(key)) {
        bucket.set(key, {
          test: {
            id: key,
            title: titleFromId(result.id),
            fullName: result.id,
            file: result.file,
            line: result.line,
          },
          line: result.line ?? 0,
        });
      }
    }
  }
  return [...buckets]
    .map(([modId, bucket]) => ({
      id: modId,
      label: cap(modId),
      tests: [...bucket.values()]
        .sort((a, b) => a.test.file.localeCompare(b.test.file) || a.line - b.line)
        .map((b) => b.test),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function buildStatuses(reports: ImplReport[]): Statuses {
  const out: Statuses = {};
  for (const r of reports) {
    for (const result of r.results) {
      const modId = moduleIdFromFile(result.file);
      const key = testKey(result.file, result.id);
      out[modId] ??= {};
      out[modId][key] ??= {};
      const cell: Cell = { status: result.status, duration_ms: result.duration_ms };
      if (result.error) cell.error = result.error;
      out[modId][key][r.impl] = cell;
    }
  }
  return out;
}

function formatRunId(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `run-${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

function wallClockMs(reports: ImplReport[]): number {
  let start = Infinity;
  let end = 0;
  for (const r of reports) {
    const s = new Date(r.startedAt).getTime();
    if (s < start) start = s;
    if (s + r.duration_ms > end) end = s + r.duration_ms;
  }
  return end - start;
}

export function mergeReports(
  reports: ImplReport[],
  meta: Omit<RunMeta, "id" | "startedAt" | "duration_ms">,
): { run: Run; index: IndexEntry } {
  const startedAt = reports.map((r) => r.startedAt).sort()[0];
  const duration_ms = wallClockMs(reports);
  const id = formatRunId(startedAt);
  const impls: Impl[] = reports
    .map((r) => ({ id: r.impl, label: cap(r.impl) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const modules = buildModules(reports);
  const statuses = buildStatuses(reports);

  let pass = 0,
    fail = 0,
    skipped = 0;
  for (const r of reports) {
    for (const t of r.results) {
      if (t.status === "pass") pass++;
      else if (t.status === "fail") fail++;
      else skipped++;
    }
  }

  return {
    run: { meta: { id, startedAt, duration_ms, ...meta }, impls, modules, statuses },
    index: {
      id,
      startedAt,
      duration_ms,
      commit: meta.commit,
      commitMessage: meta.commitMessage,
      branch: meta.branch,
      impls: impls.map((i) => i.id),
      pass,
      fail,
      skipped,
    },
  };
}
