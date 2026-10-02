// ─── Composition root (Bun + Hono) ─────────────────────────────────────────────
// Reads config → creates adapter instances → wires them into the domain workflow
// → serves the driving adapter (Hono on Bun). No business logic here.

import { loadConfig } from './infra/config.ts';
import { createPostgresFeedRepository } from './adapters/postgres.ts';
import { createFeedService } from './domain/workflows.ts';
import { createHonoApp } from './adapters/http.ts';

async function main(): Promise<void> {
  const config = loadConfig();

  // Driven adapter (Postgres) behind the FeedRepository port.
  const repository = createPostgresFeedRepository(config);

  // Domain workflows — depend only on the port.
  const service = createFeedService(repository);

  // Driving adapter (Hono) — translates HTTP ⇄ domain; served by Bun's native
  // HTTP server (hono/bun's `serve` was removed in Hono 4.13; Bun.serve is the
  // official pattern).
  const app = createHonoApp(service);
  const server = Bun.serve({ fetch: app.fetch, port: config.port });

  console.log(`bun feed-api (hono) on :${config.port} (pool ${config.poolSize})`);

  // LifetimePort: graceful exit — stop accepting, then close the DB pool.
  const shutdown = (): void => {
    void (async () => {
      await server.stop(true);
      await repository.close();
      process.exit(0);
    })();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});