# Feed API — Express 5 on Node 24 (hexagonal)

Single-process benchmark backend implementing `../infra/api-contract.md`.

## Hexagonal layout

```
node-express/
├── main.js                 # composition root (wires adapters → workflows → HTTP)
├── domain/                 # pure application logic — zero framework imports
│   ├── models.js           # User, Post (pure data)
│   ├── errors.js           # BadRequestError, NotFoundError
│   ├── ports.js            # FeedRepository + Clock port contracts
│   └── workflows.js        # FeedService — pure orchestrators (validate → drive repo)
├── adapters/
│   ├── postgres.js         # driven adapter: FeedRepository (raw SQL from the contract)
│   └── http.js             # driving adapter: Express routes, auth + DTO mapping
├── infra/
│   └── config.js           # typed config from env (only place env vars are read)
├── tests/
│   └── workflows.test.js   # unit tests with a fake repository
└── (image built inline in docker-compose.yml)
```

Dependencies point inward: `domain` knows only its ports; `adapters` implement
the ports. Swapping PostgreSQL for SQLite (the video's follow-up experiment)
means adding one adapter — the domain never changes.

## Run

```bash
npm install
npm test                          # unit tests (fake repo)
PORT=3000 DATABASE_URL=postgres://app:app@localhost:5432/app npm start
```

## Docker

```bash
docker compose up -d --build
# Traefik routes /node → node:3000, strips the prefix, app sees /api/...
curl -i -H "Authorization: Bearer 7" http://localhost/node/api/feed
```

The exact same source runs unchanged on Bun (`../bun`) — the runtime swap is the
entire experiment for this stack.