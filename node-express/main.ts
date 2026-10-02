// ─── Composition root ───────────────────────────────────────────────────────────
// Reads config → creates adapter instances → wires them into the domain workflow
// → starts the driving adapter (HTTP). No business logic here.

import { loadConfig } from './infra/config.ts';
import { createPostgresFeedRepository } from './adapters/postgres.ts';
import { createFeedService } from './domain/workflows.ts';
import { createHttpApp } from './adapters/http.ts';

async function main(): Promise<void> {
  const config = loadConfig();

  // Driven adapter (Postgres) behind the FeedRepository port.
  const repository = createPostgresFeedRepository(config);

  // Domain workflows — depend only on the port.
  const service = createFeedService(repository);

  // Driving adapter (Express) — translates HTTP ⇄ domain.
  const app = createHttpApp(service);

  const server = app.listen(config.port, () => {
    console.log(`feed-api on :${config.port} (pool ${config.poolSize})`);
  });

  // LifetimePort: graceful exit — close the DB pool on SIGTERM/SIGINT.
  const shutdown = (): void => {
    server.close(() => {
      void repository.close().then(() => process.exit(0));
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});