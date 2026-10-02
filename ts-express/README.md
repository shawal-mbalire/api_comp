# Feed API — Express 5 on Node 24, TypeScript (hexagonal)

Single-process benchmark backend implementing `../infra/api-contract.md`, written
in **strongly-typed TypeScript** and run **without a build step**: Node 24+ strips
types natively (`node main.ts`), so `tsc --noEmit` is purely a type-checker.

## Hexagonal layout

```
ts-express/
├── main.ts                  # composition root (wires adapters → workflows → HTTP)
├── domain/                  # pure application logic — zero framework imports
│   ├── models.ts            # User/Post interfaces + frozen factories
│   ├── errors.ts            # BadRequestError, NotFoundError
│   ├── ports.ts             # FeedRepository + Clock port interfaces
│   └── workflows.ts         # FeedService — pure orchestrators (validate → drive repo)
├── adapters/
│   ├── postgres.ts          # driven adapter: FeedRepository (raw SQL from the contract)
│   └── http.ts              # driving adapter: Express routes, auth + DTO mapping
├── infra/
│   └── config.ts            # typed config from env (only place env vars are read)
├── tests/
│   └── workflows.test.ts    # unit tests with a fake repository
├── tsconfig.json            # strict, noEmit — type-check only (runtimes strip types)
└── (image built inline in docker-compose.yml)
```

Dependencies point inward: `domain` knows only its ports; `adapters` implement
the ports. Swapping PostgreSQL for SQLite (the video's follow-up experiment)
means adding one adapter — the domain never changes.

## Run

```bash
npm install                  # prod + dev deps (typescript, @types/*)
npm run typecheck            # tsc --noEmit
npm test                     # unit tests (fake repo), node --test on .ts
PORT=3000 DATABASE_URL=postgres://app:app@localhost:5432/app npm start
```

## Docker

```bash
docker compose up -d --build
# Traefik routes /node → node:3000, strips the prefix, app sees /api/...
curl -i -H "Authorization: Bearer 7" http://localhost/node/api/feed
```

`ts-express` shares its hexagonal `domain/` and Postgres adapter byte-identical
with the Bun stack (`../ts-hono`), which swaps the Express driving adapter for
**Hono on Bun's native HTTP server** — the runtime/framework comparison is the
point of these two stacks.