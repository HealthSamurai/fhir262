export function createLogger(name: string): (msg: string) => void {
  return (msg: string) => {
    process.stderr.write(`[${name}] ${msg}\n`);
  };
}

export const since = (t0: number) => {
  const ms = Date.now() - t0;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
};
