import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import type { Rest } from "../../interfaces/rest";
import type { Server, ServerConnection, ServerSpec } from "../../interfaces/server";
import { createLogger, since } from "../../framework/log";

// fhir-candle is an in-memory single-process FHIR server — no database
// sidecar needed. The container listens on 5826 by default and serves
// FHIR R4 at /fhir/r4/ when started with `--r4 r4`.
const CANDLE_PORT = 5826;
const TENANT = "r4";

const VERSIONS = ["r4"];

// prepare() runs in jest's main process, connect() in workers — no shared
// memory. The base URL crosses to workers via env; the container handle (used
// only by teardown(), back in the main process) stays on globalThis.
const BASEURLS_ENV = "FHIR262_CANDLE_BASEURLS";
const STASH = Symbol.for("fhir262.candle.stacks");

const log = createLogger("fhir-candle");

interface Stack {
  candle: StartedTestContainer;
  baseUrl: string;
}

const stash = () => globalThis as unknown as { [STASH]?: Record<string, Stack> };

async function bootStack(version: string): Promise<Stack> {
  const t0 = Date.now();
  log(`starting environment for FHIR ${version}`);

  const tCandle = Date.now();
  const candle = await new GenericContainer("ghcr.io/fhir/fhir-candle:latest")
    .withExposedPorts(CANDLE_PORT)
    .withCommand(["--r4", TENANT])
    .withWaitStrategy(
      Wait.forHttp(`/fhir/${TENANT}/metadata`, CANDLE_PORT).withStartupTimeout(120_000),
    )
    .withStartupTimeout(120_000)
    .start();
  log(`fhir-candle ready in ${since(tCandle)}`);

  const baseUrl = `http://${candle.getHost()}:${candle.getMappedPort(CANDLE_PORT)}`;
  log(`environment ready at ${baseUrl} in ${since(t0)}`);
  return { candle, baseUrl };
}

function makeRest(baseUrl: string): Rest {
  const request = async (method: string, path: string, body?: unknown) => {
    const reqPath = `/fhir/${TENANT}${path}`;
    const tOp = Date.now();
    const res = await fetch(`${baseUrl}${reqPath}`, {
      method,
      headers: {
        "Content-Type": "application/fhir+json",
        Accept: "application/fhir+json",
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    log(`${method} ${reqPath} → ${res.status} in ${since(tOp)}`);
    let parsed: unknown = text;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : null;
    } catch {}
    return { status: res.status, body: parsed };
  };

  return {
    operation: (resourceType, operation, params) =>
      request("POST", `/${resourceType}/${operation}`, params),
    systemOperation: (operation, params) => request("POST", `/${operation}`, params),
    read: (resourceType, id) => request("GET", `/${resourceType}/${id}`),
    create: (resourceType, resource) => request("POST", `/${resourceType}`, resource),
    update: (resourceType, id, resource) => request("PUT", `/${resourceType}/${id}`, resource),
    delete: (resourceType, id) => request("DELETE", `/${resourceType}/${id}`),
    search: (resourceType, query) => request("GET", `/${resourceType}${query ? `?${query}` : ""}`),
  };
}

const server: Server = {
  async prepare(): Promise<void> {
    const stacks: Record<string, Stack> = {};
    await Promise.all(
      VERSIONS.map(async (version) => {
        stacks[version] = await bootStack(version);
      }),
    );

    const baseUrls: Record<string, string> = {};
    for (const [version, s] of Object.entries(stacks)) baseUrls[version] = s.baseUrl;
    process.env[BASEURLS_ENV] = JSON.stringify(baseUrls);
    stash()[STASH] = stacks;
  },

  async connect(spec: ServerSpec): Promise<ServerConnection> {
    const raw = process.env[BASEURLS_ENV];
    if (!raw) {
      throw new Error(`${BASEURLS_ENV} is unset — was prepare() (globalSetup) run?`);
    }
    const baseUrls = JSON.parse(raw) as Record<string, string>;
    const baseUrl = baseUrls[spec.fhirVersion];
    if (!baseUrl) {
      const prepared = Object.keys(baseUrls).join(", ") || "none";
      throw new Error(
        `no prepared fhir-candle for FHIR ${spec.fhirVersion} (prepared: ${prepared})`,
      );
    }
    log(`connected to ${baseUrl} for FHIR ${spec.fhirVersion}`);
    return {
      rest: makeRest(baseUrl),
      async close() {},
    };
  },

  async teardown(): Promise<void> {
    const stacks = stash()[STASH];
    if (!stacks) return;
    log("stopping environment(s)");
    const tStop = Date.now();
    await Promise.all(Object.values(stacks).map((s) => s.candle.stop()));
    log(`stopped in ${since(tStop)}`);
  },
};

export const impl = { server };
