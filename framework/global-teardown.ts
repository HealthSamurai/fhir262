import { loadImpl } from "./impl-loader";

export default async function globalTeardown(): Promise<void> {
  await loadImpl().server.teardown();
}
