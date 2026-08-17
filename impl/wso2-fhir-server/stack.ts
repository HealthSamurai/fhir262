import { Network, GenericContainer, Wait } from "testcontainers";
import { log, Stack } from "./shared";
import { since } from "../../framework/log";

const WSO2_FHIR_SERVER_PORT = 9090;
const PG_USER = "fhir"
const PG_DB = "fhirdb"
const PG_PWD = "fhir"
const PG_PORT = 5433
const PG_NETWORK_ALIAS = "postgres"

export async function bootStack(version: string): Promise<Stack> {
  const t0 = Date.now();
  log(`starting environment for FHIR ${version}`);

  const network = await new Network().start();

  log("starting postgres");
  const tPg = Date.now();
  const postgresDb = await new GenericContainer("docker.io/library/postgres:18")
    .withNetwork(network)
    .withNetworkAliases(PG_NETWORK_ALIAS)
    .withEnvironment({
      POSTGRES_USER: PG_USER,
      POSTGRES_DB: PG_DB,
      POSTGRES_PASSWORD: PG_PWD,
      PGPORT: String(PG_PORT),
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
      "-c",
      "pg_stat_statements.track=all"
    ])
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start()
    .then((c) => {
      log(`postgres ready in ${since(tPg)}`);
      return c;
    });

  log("starting wso2-fhir-server");
  const tAb = Date.now();
  const wso2FhirServer = await new GenericContainer("ghcr.io/wso2/fhir-server:latest")
    .withNetwork(network)
    .withExposedPorts(WSO2_FHIR_SERVER_PORT)
    .withEnvironment({
      SERVER_PORT: String(WSO2_FHIR_SERVER_PORT),
      BASE_URL: "http://localhost:9090/fhir/r4",
      FHIR_CREATE_TABLES: "true",
      DATABASE_URL: `postgres://${PG_USER}:${PG_PWD}@${PG_NETWORK_ALIAS}:${PG_PORT}/${PG_DB}?sslmode=disable&pool_max_conns=20`,
      LOG_LEVEL: "info",
      IG_CACHE_DIR: "/data/fhir-ig-cache",
    })
    .withWaitStrategy(Wait.forHttp("/health/ready", WSO2_FHIR_SERVER_PORT).withStartupTimeout(120_000))
    .withStartupTimeout(300_000)
    .start()
    .then((c) => {
      log(`wso2-fhir-server ready in ${since(tAb)}`);
      return c;
    });

  const baseUrl = `http://${wso2FhirServer.getHost()}:${wso2FhirServer.getMappedPort(WSO2_FHIR_SERVER_PORT)}`;
  log(`environment ready at ${baseUrl} in ${since(t0)}`);
  return { network, postgresDb, wso2FhirServer, baseUrl };
}

