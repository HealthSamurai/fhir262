import type { Rest } from "../../interfaces/rest";
import type { Server, ServerInstance } from "../../interfaces/server";

const rest: Rest = {
  async operation(resourceType: string, operation: string, params?: unknown) {
    return {
      status: 200,
      body: { resourceType: "OperationOutcome", issue: [] },
    };
  },
};

const server: Server = {
  async startWithCoreOnly(version: string): Promise<ServerInstance> {
    return {
      rest,
      async stop() {},
    };
  },
};

export const impl = {
  server,
};
