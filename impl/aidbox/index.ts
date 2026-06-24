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

const PG_PASSWORD = "pWjrFSnF1d";
const ROOT_CLIENT_SECRET = "fhir262-root-secret";

const CORE_PACKAGES: Record<string, string> = {
  r4: "hl7.fhir.r4.core#4.0.1",
};

// prepare() runs in jest's main process, connect() in workers — no shared
// memory. The base URL crosses to workers via env; the container handles (used
// only by teardown(), back in the main process) stay on globalThis.
const BASEURLS_ENV = "FHIR262_AIDBOX_BASEURLS";
const STASH = Symbol.for("fhir262.aidbox.stacks");

const log = createLogger("aidbox");

interface Stack {
  network: StartedNetwork;
  postgres: StartedTestContainer;
  aidbox: StartedTestContainer;
  baseUrl: string;
}

const stash = () => globalThis as unknown as { [STASH]?: Record<string, Stack> };

async function bootStack(version: string, pkg: string, license: string): Promise<Stack> {
  const t0 = Date.now();
  log(`starting environment for FHIR ${version}`);

  const network = await new Network().start();

  log("starting postgres + aidbox in parallel");
  const tPg = Date.now();
  const postgresPromise = new GenericContainer("docker.io/library/postgres:18")
    .withNetwork(network)
    .withNetworkAliases("postgres")
    .withEnvironment({
      POSTGRES_USER: "aidbox",
      POSTGRES_DB: "aidbox",
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
      "shared_preload_libraries=pg_stat_statements",
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

  const tAb = Date.now();
  const aidboxPromise = new GenericContainer("docker.io/healthsamurai/aidboxone:edge")
    .withNetwork(network)
    .withExposedPorts(8080)
    .withEnvironment({
      AIDBOX_LICENSE: license,
      BOX_BOOTSTRAP_FHIR_PACKAGES: pkg,
      BOX_DB_DATABASE: "aidbox",
      BOX_DB_HOST: "postgres",
      BOX_DB_PASSWORD: PG_PASSWORD,
      BOX_DB_PORT: "5432",
      BOX_DB_USER: "aidbox",
      BOX_FHIR_COMPLIANT_MODE: "true",
      BOX_FHIR_CORRECT_AIDBOX_FORMAT: "true",
      BOX_FHIR_SCHEMA_VALIDATION: "true",
      BOX_FHIR_TERMINOLOGY_ENGINE: "hybrid",
      BOX_FHIR_SEARCH_COMPARISONS: "true",
      BOX_FHIR_TERMINOLOGY_SERVICE_BASE_URL: "https://tx.health-samurai.io/fhir",
      BOX_ROOT_CLIENT_SECRET: ROOT_CLIENT_SECRET,
      BOX_SEARCH_DATE_MULTIRANGE: "true",
      BOX_SEARCH_INCLUDE_CONFORMANT: "true",
      BOX_SECURITY_DEV_MODE: "true",
      BOX_SETTINGS_MODE: "read-write",
      BOX_WEB_PORT: "8080",
    })
    .withWaitStrategy(Wait.forHttp("/health", 8080).withStartupTimeout(120_000))
    .withStartupTimeout(150_000)
    .start()
    .then((c) => {
      log(`aidbox ready in ${since(tAb)}`);
      return c;
    });

  const [postgres, aidbox] = await Promise.all([postgresPromise, aidboxPromise]);
  const baseUrl = `http://${aidbox.getHost()}:${aidbox.getMappedPort(8080)}`;
  log(`environment ready at ${baseUrl} in ${since(t0)}`);
  return { network, postgres, aidbox, baseUrl };
}

function makeRest(baseUrl: string): Rest {
  const authHeader = "Basic " + Buffer.from(`root:${ROOT_CLIENT_SECRET}`).toString("base64");

  const request = async (method: string, path: string, body?: unknown) => {
    const reqPath = `/fhir${path}`;
    const tOp = Date.now();
    const res = await fetch(`${baseUrl}${reqPath}`, {
      method,
      headers: {
        "Content-Type": "application/fhir+json",
        Accept: "application/fhir+json",
        Authorization: authHeader,
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
    const license = process.env.AIDBOX_LICENSE;
    if (!license) throw new Error("AIDBOX_LICENSE is not set (add it to .env)");

    const stacks: Record<string, Stack> = {};
    await Promise.all(
      Object.entries(CORE_PACKAGES).map(async ([version, pkg]) => {
        stacks[version] = await bootStack(version, pkg, license);
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
      throw new Error(`no prepared Aidbox for FHIR ${spec.fhirVersion} (prepared: ${prepared})`);
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
        await s.aidbox.stop();
        await s.postgres.stop();
        await s.network.stop();
      }),
    );
    log(`stopped in ${since(tStop)}`);
  },
};

export const impl = { server };
