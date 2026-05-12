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
  console.error("Usage: bun bin/run.ts -impl <impl-file.ts> [-out <result.json>]");
  process.exit(1);
}

const resolvedImpl = path.resolve(implPath);
const base = path.basename(resolvedImpl, path.extname(resolvedImpl));
const implName = base === "index" ? path.basename(path.dirname(resolvedImpl)) : base;

const { status } = spawnSync("npx", ["jest", "--config=jest.config.cjs"], {
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
