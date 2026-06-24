import { loadImpl } from "./impl-loader";

export default async function globalSetup(): Promise<void> {
  await loadImpl().server.prepare();
}
