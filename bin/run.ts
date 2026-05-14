#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import path from "node:path";

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const implPath = arg("-impl");
const outPath = arg("-out");

if (!implPath) {
  console.error(
    "Usage: bun bin/run.ts -impl <impl-file.ts> [-out <result.json>] [-filter <path-regex>] [-name <test-name>]\n" +
      "       FILTER=<path-regex> and NAME=<test-name> env vars also work.",
  );
  process.exit(1);
}

const resolvedImpl = path.resolve(implPath);
const base = path.basename(resolvedImpl, path.extname(resolvedImpl));
const implName = base === "index" ? path.basename(path.dirname(resolvedImpl)) : base;

// FILTER: jest test-path regex (positional arg).
// NAME:   jest -t name pattern (matches describe/it titles).
// Both also available as CLI flags so the script is usable outside Make.
const filter = arg("-filter") ?? process.env.FILTER;
const name = arg("-name") ?? process.env.NAME;

const jestArgs = ["jest", "--config=jest.config.cjs"];
if (name) jestArgs.push("-t", name);
if (filter) jestArgs.push(filter);

if (filter || name) {
  const parts = [];
  if (filter) parts.push(`path~/${filter}/`);
  if (name) parts.push(`name~/${name}/`);
  console.error(`[fhir262] filter: ${parts.join(" ")}`);
}

const { status } = spawnSync("npx", jestArgs, {
  stdio: "inherit",
  env: {
    ...process.env,
    FHIR262_IMPL_PATH: resolvedImpl,
    FHIR262_IMPL_NAME: implName,
    ...(outPath ? { FHIR262_OUT_PATH: path.resolve(outPath) } : {}),
  },
});

if (outPath) console.log(`Wrote ${outPath}`);
process.exit(status ?? 1);
