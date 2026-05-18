import { GenericContainer, Wait } from "testcontainers";
import type { Rest } from "../../interfaces/rest";
import type { Server, ServerInstance } from "../../interfaces/server";
import { createLogger, since } from "../../framework/log";

// fhir-candle is an in-memory single-process FHIR server — no database
// sidecar needed. The container listens on 5826 by default and serves
// FHIR R4 at /fhir/r4/ when started with `--r4 r4`.
const CANDLE_PORT = 5826;
const TENANT = "r4";

const log = createLogger("fhir-candle");

const server: Server = {
  async startWithCoreOnly(version: string): Promise<ServerInstance> {
    if (version !== "r4") throw new Error(`unsupported FHIR version: ${version}`);

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

    const rest: Rest = {
      operation: (resourceType, operation, params) =>
        request("POST", `/${resourceType}/${operation}`, params),
      systemOperation: (operation, params) => request("POST", `/${operation}`, params),
      read: (resourceType, id) => request("GET", `/${resourceType}/${id}`),
      create: (resourceType, resource) => request("POST", `/${resourceType}`, resource),
      update: (resourceType, id, resource) =>
        request("PUT", `/${resourceType}/${id}`, resource),
      delete: (resourceType, id) => request("DELETE", `/${resourceType}/${id}`),
      search: (resourceType, query) =>
        request("GET", `/${resourceType}${query ? `?${query}` : ""}`),
    };

    return {
      rest,
      async stop() {
        log("stopping environment");
        const tStop = Date.now();
        await candle.stop();
        log(`stopped in ${since(tStop)}`);
      },
    };
  },
};

export const impl = { server };
