# Feed API — Hono on the Bun runtime, TypeScript (hexagonal)

Benchmark backend implementing `../infra/api-contract.md` with **Hono** — a
web-standard (Request/Response) framework — served by **Bun's native HTTP
server**. Unlike the Node stack (`../node-express`) there is **no Express**
anywhere: Hono is the only web layer and Bun runs the `.ts` files natively
(zero build step; `tsc --noEmit` is a type-checker only).

## Layout

```
bun/
├── main.ts                  # composition root → Bun.serve({ fetch: app.fetch })
├── domain/                  # byte-identical to node-express: pure application
│   ├── models.ts            #   logic (User/Post interfaces + frozen factories)
│   ├── errors.ts            #   BadRequestError, NotFoundError
│   ├── ports.ts             #   FeedRepository + Clock port interfaces
│   └── workflows.ts         #   FeedService — pure orchestrators
├── adapters/
│   ├── postgres.ts          # driven adapter (byte-identical to node-express)
│   └── http.ts              # driving adapter: Hono routes, auth + DTO mapping
├── infra/
│   └── config.ts            # typed config from env (only place env vars are read)
├── tests/
│   ├── workflows.test.ts    # domain unit tests (bun:test, fake repo)
│   └── http.test.ts         # HTTP tests via Hono's app.request (no socket/DB)
├── tsconfig.json            # strict, noEmit, types:["bun"]
└── (image built inline in docker-compose.yml)
```

Dependencies point inward: `domain` knows only its ports; `adapters` implement
the ports — only `adapters/http.ts` differs from the Node stack.

## Run

```bash
bun install
bun run typecheck            # tsc --noEmit
bun test                     # 15 tests (domain + HTTP adapter)
PORT=3001 DATABASE_URL=postgres://app:app@localhost:5432/app bun run main.ts
```

## Docker

```bash
docker compose up -d --build
# Traefik routes /bun → bun:3001 (prefix stripped)
curl -i -H "Authorization: Bearer 7" http://localhost/bun/api/feed
```