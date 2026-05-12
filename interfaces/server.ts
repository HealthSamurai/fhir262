import type { Rest } from "./rest";

export interface Server {
  startWithCoreOnly(version: string): Promise<ServerInstance>;
}

export interface ServerInstance {
  stop(): Promise<void>;
  rest: Rest;
}
