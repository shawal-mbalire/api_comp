'use strict';

// ─── Composition root ───────────────────────────────────────────────────────────
// Reads config → creates adapter instances → wires them into the domain workflow
// → starts the driving adapter (HTTP). No business logic here.

const { loadConfig } = require('./infra/config');
const { createPostgresFeedRepository } = require('./adapters/postgres');
const { createFeedService } = require('./domain/workflows');
const { createHttpApp } = require('./adapters/http');

async function main() {
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
  const shutdown = () => {
    server.close(() => repository.close().then(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});