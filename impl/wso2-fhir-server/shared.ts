import { StartedNetwork, type StartedTestContainer} from "testcontainers";
import { createLogger } from "../../framework/log";

export const log = createLogger("wso2-fhir-server");
export const VERSION = "r4";
export const STASH = Symbol.for("fhir262.wso2-fhir-server.stacks");
export const stash = () => globalThis as unknown as { [STASH]?: Record<string, Stack> };
export const BASE_URL_ENV_VAR_NAME = "WSO2_FHIR_SERVER_BASE_URL";
export interface Stack {
  network: StartedNetwork;
  wso2FhirServer: StartedTestContainer;
  postgresDb: StartedTestContainer;
  baseUrl: string;
}

