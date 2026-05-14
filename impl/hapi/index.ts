import { GenericContainer, Wait } from "testcontainers";
import type { Rest } from "../../interfaces/rest";
import type { Server, ServerInstance } from "../../interfaces/server";
import { createLogger, since } from "../../framework/log";

const HAPI_PORT = 8080;

const log = createLogger("hapi");

const server: Server = {
  async startWithCoreOnly(version: string): Promise<ServerInstance> {
    if (version !== "r4") throw new Error(`unsupported FHIR version: ${version}`);

    const t0 = Date.now();
    log(`starting environment for FHIR ${version}`);

    // HAPI uses an embedded H2 database by default, so no companion DB is
    // needed. Config mirrors fhir-server-compare's docker-compose entry for
    // the "permissive baseline" HAPI service.
    const hapi = await new GenericContainer("hapiproject/hapi:v8.8.0-1")
      .withExposedPorts(HAPI_PORT)
      .withEnvironment({
        "hapi.fhir.fhir_version": "R4",
        "hapi.fhir.bulk_export_enabled": "true",
        "hapi.fhir.binary_storage_enabled": "true",
      })
      .withWaitStrategy(Wait.forHttp("/fhir/metadata", HAPI_PORT).withStartupTimeout(240_000))
      .withStartupTimeout(240_000)
      .start();

    const baseUrl = `http://${hapi.getHost()}:${hapi.getMappedPort(HAPI_PORT)}`;
    log(`environment ready at ${baseUrl} in ${since(t0)}`);

    const post = async (path: string, params: unknown) => {
      const reqPath = `/fhir${path}`;
      const tOp = Date.now();
      const res = await fetch(`${baseUrl}${reqPath}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/fhir+json",
          Accept: "application/fhir+json",
        },
        body: params == null ? undefined : JSON.stringify(params),
      });
      const text = await res.text();
      log(`POST ${reqPath} → ${res.status} in ${since(tOp)}`);
      let body: unknown = text;
      try {
        body = text.length > 0 ? JSON.parse(text) : null;
      } catch {}
      return { status: res.status, body };
    };

    const rest: Rest = {
      operation: (resourceType, operation, params) => post(`/${resourceType}/${operation}`, params),
      systemOperation: (operation, params) => post(`/${operation}`, params),
    };

    return {
      rest,
      async stop() {
        log("stopping environment");
        const tStop = Date.now();
        await hapi.stop();
        log(`stopped in ${since(tStop)}`);
      },
    };
  },
};

export const impl = { server };
