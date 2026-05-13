import { GenericContainer, Network, Wait } from "testcontainers";
import type { Rest } from "../../interfaces/rest";
import type { Server, ServerInstance } from "../../interfaces/server";
import { createLogger, since } from "../../framework/log";

// SQL Server enforces a strong-password policy: 8+ chars, upper, lower, digit,
// symbol. Keeping this in source is fine — the container is per-test-file and
// not exposed outside the testcontainers network.
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

const log = createLogger("msfhir");

const server: Server = {
  async startWithCoreOnly(version: string): Promise<ServerInstance> {
    if (version !== "r4") throw new Error(`unsupported FHIR version: ${version}`);

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

    const rest: Rest = {
      async operation(resourceType, operation, params) {
        // MS FHIR Server serves resources at the root, not under /fhir/R4.
        const reqPath = `/${resourceType}/${operation}`;
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
      },
    };

    return {
      rest,
      async stop() {
        log("stopping environment");
        const tStop = Date.now();
        await fhir.stop();
        await sql.stop();
        await network.stop();
        log(`stopped in ${since(tStop)}`);
      },
    };
  },
};

export const impl = { server };
