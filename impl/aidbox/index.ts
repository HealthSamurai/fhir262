import { GenericContainer, Network, Wait } from "testcontainers";
import type { Rest } from "../../interfaces/rest";
import type { Server, ServerInstance } from "../../interfaces/server";
import { createLogger, since } from "../../framework/log";

const PG_PASSWORD = "pWjrFSnF1d";
const ROOT_CLIENT_SECRET = "fhir262-root-secret";

const CORE_PACKAGES: Record<string, string> = {
  r4: "hl7.fhir.r4.core#4.0.1",
};

const log = createLogger("aidbox");

const server: Server = {
  async startWithCoreOnly(version: string): Promise<ServerInstance> {
    const pkg = CORE_PACKAGES[version];
    if (!pkg) throw new Error(`unsupported FHIR version: ${version}`);

    const license = process.env.AIDBOX_LICENSE;
    if (!license) throw new Error("AIDBOX_LICENSE is not set (add it to .env)");

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
      })
      .withCommand(["postgres", "-c", "shared_preload_libraries=pg_stat_statements"])
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
        BOX_FHIR_SCHEMA_VALIDATION: "true",
        BOX_FHIR_TERMINOLOGY_ENGINE: "hybrid",
        BOX_ROOT_CLIENT_SECRET: ROOT_CLIENT_SECRET,
        BOX_SECURITY_DEV_MODE: "true",
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
    const authHeader = "Basic " + Buffer.from(`root:${ROOT_CLIENT_SECRET}`).toString("base64");

    const rest: Rest = {
      async operation(resourceType, operation, params) {
        const path = `/fhir/${resourceType}/$${operation}`;
        const tOp = Date.now();
        const res = await fetch(`${baseUrl}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/fhir+json",
            Accept: "application/fhir+json",
            Authorization: authHeader,
          },
          body: params == null ? undefined : JSON.stringify(params),
        });
        const text = await res.text();
        log(`POST ${path} → ${res.status} in ${since(tOp)}`);
        let body: unknown = text;
        try {
          body = text.length > 0 ? JSON.parse(text) : null;
        } catch {}
        return { status: res.status, body };
      },
    };

    return {
      rest,
      async stop() {
        log("stopping environment");
        const tStop = Date.now();
        await aidbox.stop();
        await postgres.stop();
        await network.stop();
        log(`stopped in ${since(tStop)}`);
      },
    };
  },
};

export const impl = { server };
