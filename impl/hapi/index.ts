import {
  GenericContainer,
  Network,
  type StartedNetwork,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import type { Rest } from "../../interfaces/rest";
import type { Server, ServerConnection, ServerSpec } from "../../interfaces/server";
import { createLogger, since } from "../../framework/log";

const HAPI_PORT = 8080;
const PG_USER = "postgres";
const PG_PASSWORD = "postgres";
const PG_DB = "hapi";

const VERSIONS = ["r4"];

// prepare() runs in jest's main process, connect() in workers — no shared
// memory. The base URL crosses to workers via env; the container handles (used
// only by teardown(), back in the main process) stay on globalThis.
const BASEURLS_ENV = "FHIR262_HAPI_BASEURLS";
const STASH = Symbol.for("fhir262.hapi.stacks");

const log = createLogger("hapi");

interface Stack {
  network: StartedNetwork;
  postgres: StartedTestContainer;
  hapi: StartedTestContainer;
  baseUrl: string;
}

const stash = () => globalThis as unknown as { [STASH]?: Record<string, Stack> };

async function bootStack(version: string): Promise<Stack> {
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
      // Subdir of the tmpfs mount below: the entrypoint creates it 0700, which
      // initdb requires (a bare tmpfs mount comes up 1777 and is rejected).
      PGDATA: "/pgtmp/data",
    })
    // DB is recreated per run and discarded: keep it in RAM (tmpfs) and skip
    // durability (fsync/synchronous_commit/full_page_writes) for faster writes.
    .withTmpFs({ "/pgtmp": "rw,size=2g" })
    .withCommand([
      "postgres",
      "-c",
      "fsync=off",
      "-c",
      "synchronous_commit=off",
      "-c",
      "full_page_writes=off",
    ])
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
  return { network, postgres, hapi, baseUrl };
}

function makeRest(baseUrl: string): Rest {
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
      throw new Error(`no prepared HAPI for FHIR ${spec.fhirVersion} (prepared: ${prepared})`);
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
    await Promise.all(
      Object.values(stacks).map(async (s) => {
        await s.hapi.stop();
        await s.postgres.stop();
        await s.network.stop();
      }),
    );
    log(`stopped in ${since(tStop)}`);
  },
};

export const impl = { server };
