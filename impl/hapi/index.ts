import { GenericContainer, Network, Wait } from "testcontainers";
import type { Rest } from "../../interfaces/rest";
import type { Server, ServerInstance } from "../../interfaces/server";
import { createLogger, since } from "../../framework/log";

const HAPI_PORT = 8080;
const PG_USER = "postgres";
const PG_PASSWORD = "postgres";
const PG_DB = "hapi";

const log = createLogger("hapi");

const server: Server = {
  async startWithCoreOnly(version: string): Promise<ServerInstance> {
    if (version !== "r4") throw new Error(`unsupported FHIR version: ${version}`);

    const t0 = Date.now();
    log(`starting environment for FHIR ${version}`);

    const network = await new Network().start();

    log("starting postgres + hapi in parallel");
    const tPg = Date.now();
    const postgresPromise = new GenericContainer("docker.io/library/postgres:18")
      .withNetwork(network)
      .withNetworkAliases("postgres")
      .withEnvironment({
        POSTGRES_USER: PG_USER,
        POSTGRES_DB: PG_DB,
        POSTGRES_PASSWORD: PG_PASSWORD,
      })
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
      .then((c) => {
        log(`postgres ready in ${since(tPg)}`);
        return c;
      });

    const tHapi = Date.now();
    const hapiPromise = new GenericContainer("hapiproject/hapi:v8.8.0-1")
      .withNetwork(network)
      .withExposedPorts(HAPI_PORT)
      .withEnvironment({
        JAVA_OPTS: "-XX:MaxRAMPercentage=80 -XshowSettings:vm",
        "hapi.fhir.fhir_version": "R4",
        "hapi.fhir.graphql_enabled": "true",
        "hapi.fhir.bulk_export_enabled": "true",
        "hapi.fhir.enable_index_missing_fields": "true",
        "hapi.fhir.reuse_cached_search_results_millis": "0",
        // Search modifier opt-ins required by the test suite (HAPI disables
        // these by default; the benchmark doesn't need them).
        "hapi.fhir.binary_storage_enabled": "true",
        "hapi.fhir.enable_index_of_type": "true",
        "hapi.fhir.allow_contains_searches": "true",
        "spring.datasource.url": `jdbc:postgresql://postgres/${PG_DB}`,
        "spring.datasource.username": PG_USER,
        "spring.datasource.password": PG_PASSWORD,
        "spring.datasource.driverClassName": "org.postgresql.Driver",
        "spring.datasource.hikari.maximum-pool-size": "32",
        "spring.jpa.properties.hibernate.dialect":
          "ca.uhn.fhir.jpa.model.dialect.HapiFhirPostgresDialect",
        "spring.jpa.properties.hibernate.search.enabled": "false",
      })
      .withWaitStrategy(Wait.forHttp("/fhir/metadata", HAPI_PORT).withStartupTimeout(240_000))
      .withStartupTimeout(240_000)
      .start()
      .then((c) => {
        log(`hapi ready in ${since(tHapi)}`);
        return c;
      });

    const [postgres, hapi] = await Promise.all([postgresPromise, hapiPromise]);

    const baseUrl = `http://${hapi.getHost()}:${hapi.getMappedPort(HAPI_PORT)}`;
    log(`environment ready at ${baseUrl} in ${since(t0)}`);

    const request = async (method: string, path: string, body?: unknown) => {
      const reqPath = `/fhir${path}`;
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
        await hapi.stop();
        await postgres.stop();
        await network.stop();
        log(`stopped in ${since(tStop)}`);
      },
    };
  },
};

export const impl = { server };
