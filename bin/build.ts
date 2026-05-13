#!/usr/bin/env bun
// Builds a previewable dist/ from per-impl reports + ui/ source.
//
//   bun bin/build.ts -results .results -dist dist
//
// What it does:
//   - reads every .results/*.json (per-impl reports written by jest reporter)
//   - merges them into a single run JSON
//   - writes dist/runs/<id>.json
//   - copies ui/* into dist/
//   - rebuilds dist/runs/index.json by scanning dist/runs/*.json
//
// Pre-existing runs under dist/runs/ are preserved — the new run is added
// alongside them. This is how CI accumulates run history across deploys.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { mergeReports, type ImplReport, type IndexEntry } from "../framework/build-run";

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const resultsDir = path.resolve(arg("-results") || ".results");
const distDir = path.resolve(arg("-dist") || "dist");

// The CLI is invoked from the repo root (via `bun bin/build.ts` or a make target).
const repoRoot = process.cwd();
const uiDir = path.join(repoRoot, "ui");
const runsDir = path.join(distDir, "runs");

function sh(cmd: string, fallback = ""): string {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return fallback;
  }
}

function gitMeta() {
  const commit =
    process.env.GITHUB_SHA?.slice(0, 7) ||
    sh("git rev-parse --short HEAD", "unknown");
  const branch =
    process.env.GITHUB_REF_NAME ||
    sh("git rev-parse --abbrev-ref HEAD", "unknown");
  const commitMessage = sh(`git log -1 --pretty=%s`, "");

  let repoUrl = process.env.FHIR262_REPO_URL || "";
  if (!repoUrl) {
    const origin = sh("git config --get remote.origin.url");
    if (origin) {
      // git@github.com:foo/bar.git → https://github.com/foo/bar
      // https://github.com/foo/bar.git → https://github.com/foo/bar
      repoUrl = origin
        .replace(/^git@([^:]+):/, "https://$1/")
        .replace(/\.git$/, "");
    }
  }
  return { commit, branch, commitMessage, repoUrl };
}

function suiteVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
    );
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function readImplReports(dir: string): ImplReport[] {
  if (!fs.existsSync(dir)) return [];
  const out: ImplReport[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const p = path.join(dir, entry);
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    if (raw && typeof raw.impl === "string" && Array.isArray(raw.results)) {
      out.push(raw as ImplReport);
    }
  }
  return out;
}

function copyUi() {
  fs.mkdirSync(distDir, { recursive: true });
  for (const entry of fs.readdirSync(uiDir)) {
    const src = path.join(uiDir, entry);
    const dst = path.join(distDir, entry);
    fs.copyFileSync(src, dst);
  }
}

function rebuildIndex(): IndexEntry[] {
  fs.mkdirSync(runsDir, { recursive: true });
  const entries: IndexEntry[] = [];
  for (const entry of fs.readdirSync(runsDir)) {
    if (!entry.endsWith(".json") || entry === "index.json") continue;
    const p = path.join(runsDir, entry);
    try {
      const run = JSON.parse(fs.readFileSync(p, "utf8"));
      if (!run?.meta?.id) continue;
      let pass = 0,
        fail = 0,
        skipped = 0;
      const statuses = run.statuses || {};
      for (const mod of Object.keys(statuses)) {
        for (const test of Object.keys(statuses[mod])) {
          for (const impl of Object.keys(statuses[mod][test])) {
            const s = statuses[mod][test][impl].status;
            if (s === "pass") pass++;
            else if (s === "fail") fail++;
            else skipped++;
          }
        }
      }
      entries.push({
        id: run.meta.id,
        startedAt: run.meta.startedAt,
        duration_ms: run.meta.duration_ms,
        commit: run.meta.commit,
        commitMessage: run.meta.commitMessage,
        branch: run.meta.branch,
        impls: (run.impls || []).map((i: { id: string }) => i.id),
        pass,
        fail,
        skipped,
      });
    } catch (e) {
      console.warn(`build: skipping ${entry} — ${(e as Error).message}`);
    }
  }
  entries.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  fs.writeFileSync(
    path.join(runsDir, "index.json"),
    JSON.stringify({ runs: entries }, null, 2) + "\n"
  );
  return entries;
}

function main() {
  copyUi();
  fs.mkdirSync(runsDir, { recursive: true });

  const reports = readImplReports(resultsDir);
  if (reports.length === 0) {
    console.warn(
      `build: no .json reports under ${path.relative(process.cwd(), resultsDir)} — skipping merge`
    );
  } else {
    const meta = gitMeta();
    const { run } = mergeReports(reports, {
      ...meta,
      suiteVersion: suiteVersion(),
    });
    const outFile = path.join(runsDir, `${run.meta.id}.json`);
    fs.writeFileSync(outFile, JSON.stringify(run, null, 2) + "\n");
    console.log(
      `build: merged ${reports.length} impl report(s) → ${path.relative(process.cwd(), outFile)}`
    );
  }

  const entries = rebuildIndex();
  console.log(
    `build: ${entries.length} run(s) indexed → ${path.relative(
      process.cwd(),
      path.join(runsDir, "index.json")
    )}`
  );
  console.log(`build: dist ready at ${path.relative(process.cwd(), distDir)}`);
}

main();
