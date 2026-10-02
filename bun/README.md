# Feed API — Express 5 on the Bun runtime (hexagonal)

**Byte-identical application source** to `../node-express` (domain/, adapters/,
infra/, main.js, tests/) — swapping only the runtime (Node 22 → Bun) per the
experiment, zero application-code rewrite.

## Layout

Identical to `../node-express` (see its README): `main.js` composition root +
`domain/` (models, errors, ports, workflows) + `adapters/` (http, postgres) +
`infra/config.js` + `tests/`.

## Run

```bash
bun install
PORT=3001 DATABASE_URL=postgres://app:app@localhost:5432/app bun run main.js
```

## Docker

```bash
docker compose up -d --build
# Traefik routes /bun → bun:3001 (prefix stripped)
curl -i -H "Authorization: Bearer 7" http://localhost/bun/api/feed
```