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

// SQL Server enforces a strong-password policy: 8+ chars, upper, lower, digit,
// symbol. Keeping this in source is fine — the container is per-run and not
// exposed outside the testcontainers network.
const SA_PASSWORD = "Fhir262_StrongPass!";
const MSFHIR_PORT = 8080;
const SQL_HOST_ALIAS = "msfhir-db";

// TrustServerCertificate=True + Encrypt=False match fhir-server-compare's
// notes: SQL Server 2022 ships with a self-signed cert and the modern
// SqlClient bundled in the FHIR server image enforces cert validation by
// default, so without these two flags the FHIR server boot-loops on a TLS
// handshake error.
const SQL_CONN = [
  `Server=tcp:${SQL_HOST_ALIAS},1433`,
  "Initial Catalog=FHIR",
  "Persist Security Info=False",
  "User ID=sa",
  `Password=${SA_PASSWORD}`,
  "MultipleActiveResultSets=False",
  "Connection Timeout=30",
  "TrustServerCertificate=True",
  "Encrypt=False;",
].join(";");

const VERSIONS = ["r4"];

// prepare() runs in jest's main process, connect() in workers — no shared
// memory. The base URL crosses to workers via env; the container handles (used
// only by teardown(), back in the main process) stay on globalThis.
const BASEURLS_ENV = "FHIR262_MSFHIR_BASEURLS";
const STASH = Symbol.for("fhir262.msfhir.stacks");

const log = createLogger("msfhir");

interface Stack {
  network: StartedNetwork;
  sql: StartedTestContainer;
  fhir: StartedTestContainer;
  baseUrl: string;
}

const stash = () => globalThis as unknown as { [STASH]?: Record<string, Stack> };

async function bootStack(version: string): Promise<Stack> {
  const t0 = Date.now();
  log(`starting environment for FHIR ${version}`);

  const network = await new Network().start();

  log("starting sqlserver + msfhir in parallel");

  const tSql = Date.now();
  const sqlPromise = new GenericContainer("mcr.microsoft.com/mssql/server:2022-latest")
    .withNetwork(network)
    .withNetworkAliases(SQL_HOST_ALIAS)
    .withEnvironment({
      ACCEPT_EULA: "Y",
      SA_PASSWORD,
      MSSQL_PID: "Developer",
    })
    .withWaitStrategy(Wait.forLogMessage(/SQL Server is now ready for client connections/))
    .withStartupTimeout(180_000)
    .start()
    .then((c) => {
      log(`sqlserver ready in ${since(tSql)}`);
      return c;
    });

  const tFhir = Date.now();
  const fhirPromise = new GenericContainer("mcr.microsoft.com/healthcareapis/r4-fhir-server:latest")
    .withNetwork(network)
    .withExposedPorts(MSFHIR_PORT)
    .withEnvironment({
      FHIRServer__Security__Enabled: "false",
      SqlServer__ConnectionString: SQL_CONN,
      SqlServer__AllowDatabaseCreation: "true",
      SqlServer__Initialize: "true",
      SqlServer__SchemaOptions__AutomaticUpdatesEnabled: "true",
      DataStore: "SqlServer",
      ASPNETCORE_URLS: `http://+:${MSFHIR_PORT}`,
    })
    .withWaitStrategy(Wait.forHttp("/health/check", MSFHIR_PORT).withStartupTimeout(240_000))
    .withStartupTimeout(240_000)
    .start()
    .then((c) => {
      log(`msfhir ready in ${since(tFhir)}`);
      return c;
    });

  const [sql, fhir] = await Promise.all([sqlPromise, fhirPromise]);
  const baseUrl = `http://${fhir.getHost()}:${fhir.getMappedPort(MSFHIR_PORT)}`;
  log(`environment ready at ${baseUrl} in ${since(t0)}`);
  return { network, sql, fhir, baseUrl };
}

function makeRest(baseUrl: string): Rest {
  // MS FHIR Server serves resources at the root, not under /fhir/R4.
  const request = async (method: string, path: string, body?: unknown) => {
    const tOp = Date.now();
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/fhir+json",
        Accept: "application/fhir+json",
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    log(`${method} ${path} → ${res.status} in ${since(tOp)}`);
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
      throw new Error(`no prepared MS FHIR for FHIR ${spec.fhirVersion} (prepared: ${prepared})`);
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
        await s.fhir.stop();
        await s.sql.stop();
        await s.network.stop();
      }),
    );
    log(`stopped in ${since(tStop)}`);
  },
};

export const impl = { server };
