// ─── Infra: config plumbing. The ONLY place environment variables are read.
//     Returns a frozen, typed config object consumed by the composition root.

/** Frozen configuration consumed by the composition root. */
export interface Config {
  readonly port: number;
  readonly connectionUri: string;
  readonly poolSize: number;
}

const DEFAULTS: Readonly<Config> = Object.freeze({
  port: 3000,
  connectionUri: 'postgres://app:app@db:5432/app',
  poolSize: 10,
});

/** Read one env var as a positive number, falling back on garbage/absence. */
function numberFromEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Object.freeze({
    port: numberFromEnv(env.PORT, DEFAULTS.port),
    connectionUri: env.DATABASE_URL || DEFAULTS.connectionUri,
    // Experiment hard limit: exactly POOL_SIZE connections per process.
    poolSize: numberFromEnv(env.POOL_SIZE, DEFAULTS.poolSize),
  });
}