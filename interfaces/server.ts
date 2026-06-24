import type { Rest } from "./rest";

// prepare/teardown run once in jest's main process; connect runs per worker and
// must be cheap — build a client, don't start a server.
export interface Server {
  prepare(): Promise<void>;
  teardown(): Promise<void>;
  connect(spec: ServerSpec): Promise<ServerConnection>;
}

export interface ServerSpec {
  fhirVersion: string;
}

export interface ServerConnection {
  close(): Promise<void>;
  rest: Rest;
}
