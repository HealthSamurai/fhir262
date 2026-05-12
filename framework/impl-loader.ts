import type { Server } from "../interfaces/server";

function implPath(): string {
  const p = process.env.FHIR262_IMPL_PATH;
  if (!p) throw new Error("FHIR262_IMPL_PATH not set");
  return p;
}

interface Impl {
  server: Server;
}

export function loadImpl(): Impl {
  const mod = require(implPath());
  return mod.impl as Impl;
}
