import { since } from "../../framework/log";
import { Server, ServerConnection, ServerSpec } from "../../interfaces/server";
import { makeRest } from "./rest";
import { BASE_URL_ENV_VAR_NAME, log, Stack, STASH, stash, VERSION } from "./shared";
import { bootStack } from "./stack";

export const wso2FhirServer: Server = {
  async prepare(): Promise<void> {
    const stacks: Record<string, Stack> = {};
    stacks[VERSION] = await bootStack(VERSION);
    const baseUrls: Record<string, string> = {};
    baseUrls[VERSION] = stacks[VERSION].baseUrl;
    process.env[BASE_URL_ENV_VAR_NAME] = JSON.stringify(baseUrls);
    stash()[STASH] = stacks;
  },

  async connect(spec: ServerSpec): Promise<ServerConnection> {
    const raw = process.env[BASE_URL_ENV_VAR_NAME];
    if (!raw) {
      throw new Error(`${BASE_URL_ENV_VAR_NAME} is unset — was prepare() (globalSetup) run?`);
    }
    const baseUrls = JSON.parse(raw) as Record<string, string>;
    const baseUrl = baseUrls[spec.fhirVersion];
    if (!baseUrl) {
      const prepared = Object.keys(baseUrls).join(", ") || "none";
      throw new Error(
        `no prepared wso2-fhir-server for FHIR ${spec.fhirVersion} (prepared: ${prepared})`,
      );
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
    await Promise.all(Object.values(stacks).map((s) => {
      s.network.stop(); 
      s.postgresDb.stop(); 
      s.wso2FhirServer.stop()
    }));
    log(`stopped in ${since(tStop)}`);
  },
};

