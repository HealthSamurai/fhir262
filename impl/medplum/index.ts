import path from "node:path";
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

const PG_PASSWORD = "postgres";
const MEDPLUM_PORT = 8103;
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "medplum_admin";

const CONFIG_PATH = path.join(__dirname, "config.json");
const INIT_SQL_PATH = path.join(__dirname, "init.sql");

const VERSIONS = ["r4"];

// prepare() runs in jest's main process, connect() in workers — no shared
// memory. The base URL crosses to workers via env; the container handles (used
// only by teardown(), back in the main process) stay on globalThis.
const BASEURLS_ENV = "FHIR262_MEDPLUM_BASEURLS";
const STASH = Symbol.for("fhir262.medplum.stacks");

const log = createLogger("medplum");

interface Stack {
  network: StartedNetwork;
  postgres: StartedTestContainer;
  redis: StartedTestContainer;
  medplum: StartedTestContainer;
  baseUrl: string;
}

const stash = () => globalThis as unknown as { [STASH]?: Record<string, Stack> };

async function obtainAccessToken(baseUrl: string): Promise<string> {
  const challenge = "fhir262_challenge";

  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      codeChallengeMethod: "plain",
      codeChallenge: challenge,
    }),
  });
  if (!loginRes.ok) {
    throw new Error(`auth/login failed: ${loginRes.status} ${await loginRes.text()}`);
  }
  const { code } = (await loginRes.json()) as { code: string };

  const tokenRes = await fetch(`${baseUrl}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&code_verifier=${challenge}`,
  });
  if (!tokenRes.ok) {
    throw new Error(`oauth2/token failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  return access_token;
}

async function bootStack(version: string): Promise<Stack> {
  const t0 = Date.now();
  log(`starting environment for FHIR ${version}`);

  const network = await new Network().start();

  log("starting postgres + redis + medplum in parallel");

  const tPg = Date.now();
  const postgresPromise = new GenericContainer("docker.io/library/postgres:18")
    .withNetwork(network)
    .withNetworkAliases("postgres")
    .withEnvironment({
      POSTGRES_USER: "postgres",
      POSTGRES_PASSWORD: PG_PASSWORD,
      POSTGRES_DB: "medplum",
      // Subdir of the tmpfs mount below: the entrypoint creates it 0700, which
      // initdb requires (a bare tmpfs mount comes up 1777 and is rejected).
      PGDATA: "/pgtmp/data",
    })
    .withCopyFilesToContainer([
      { source: INIT_SQL_PATH, target: "/docker-entrypoint-initdb.d/init.sql" },
    ])
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

  const tRedis = Date.now();
  const redisPromise = new GenericContainer("docker.io/library/redis:7")
    .withNetwork(network)
    .withNetworkAliases("redis")
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start()
    .then((c) => {
      log(`redis ready in ${since(tRedis)}`);
      return c;
    });

  const tMp = Date.now();
  const medplumPromise = new GenericContainer("docker.io/medplum/medplum-server:latest")
    .withNetwork(network)
    .withExposedPorts(MEDPLUM_PORT)
    .withCommand(["file:/srv/config.json"])
    .withCopyFilesToContainer([{ source: CONFIG_PATH, target: "/srv/config.json" }])
    .withWaitStrategy(Wait.forHttp("/healthcheck", MEDPLUM_PORT).withStartupTimeout(180_000))
    .withStartupTimeout(180_000)
    .start()
    .then((c) => {
      log(`medplum ready in ${since(tMp)}`);
      return c;
    });

  const [postgres, redis, medplum] = await Promise.all([
    postgresPromise,
    redisPromise,
    medplumPromise,
  ]);

  const baseUrl = `http://${medplum.getHost()}:${medplum.getMappedPort(MEDPLUM_PORT)}`;
  log(`environment ready at ${baseUrl} in ${since(t0)}`);
  return { network, postgres, redis, medplum, baseUrl };
}

function makeRest(baseUrl: string, authHeader: string): Rest {
  const request = async (method: string, path: string, body?: unknown) => {
    const reqPath = `/fhir/R4${path}`;
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
      throw new Error(`no prepared Medplum for FHIR ${spec.fhirVersion} (prepared: ${prepared})`);
    }
    log(`obtaining oauth2 access token for ${baseUrl}`);
    const tAuth = Date.now();
    const accessToken = await obtainAccessToken(baseUrl);
    log(`access token obtained in ${since(tAuth)}`);
    return {
      rest: makeRest(baseUrl, `Bearer ${accessToken}`),
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
        await s.medplum.stop();
        await s.redis.stop();
        await s.postgres.stop();
        await s.network.stop();
      }),
    );
    log(`stopped in ${since(tStop)}`);
  },
};

export const impl = { server };
