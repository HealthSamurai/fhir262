import path from "node:path";
import { GenericContainer, Network, Wait } from "testcontainers";
import type { Rest } from "../../interfaces/rest";
import type { Server, ServerInstance } from "../../interfaces/server";
import { createLogger, since } from "../../framework/log";

const PG_PASSWORD = "postgres";
const MEDPLUM_PORT = 8103;
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "medplum_admin";

const CONFIG_PATH = path.join(__dirname, "config.json");
const INIT_SQL_PATH = path.join(__dirname, "init.sql");

const log = createLogger("medplum");

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

const server: Server = {
  async startWithCoreOnly(version: string): Promise<ServerInstance> {
    if (version !== "r4") throw new Error(`unsupported FHIR version: ${version}`);

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
      })
      .withCopyFilesToContainer([
        { source: INIT_SQL_PATH, target: "/docker-entrypoint-initdb.d/init.sql" },
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

    log("obtaining oauth2 access token");
    const tAuth = Date.now();
    const accessToken = await obtainAccessToken(baseUrl);
    log(`access token obtained in ${since(tAuth)}`);

    const authHeader = `Bearer ${accessToken}`;

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
        await medplum.stop();
        await redis.stop();
        await postgres.stop();
        await network.stop();
        log(`stopped in ${since(tStop)}`);
      },
    };
  },
};

export const impl = { server };
