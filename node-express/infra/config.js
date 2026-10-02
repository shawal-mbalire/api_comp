'use strict';

// ─── Infra: config plumbing. The ONLY place environment variables are read.
//     Returns a frozen, typed config object consumed by the composition root.

const DEFAULTS = Object.freeze({
  port: 3000,
  databaseUrl: 'postgres://app:app@db:5432/app',
  poolSize: 10,
});

function numberFromEnv(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** @param {NodeJS.ProcessEnv} env */
function loadConfig(env = process.env) {
  return Object.freeze({
    port: numberFromEnv(env.PORT, DEFAULTS.port),
    connectionUri: env.DATABASE_URL || DEFAULTS.databaseUrl,
    // Experiment hard limit: exactly POOL_SIZE connections per process.
    poolSize: numberFromEnv(env.POOL_SIZE, DEFAULTS.poolSize),
  });
}

module.exports = { loadConfig };