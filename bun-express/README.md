# Feed API — Express 5 on the Bun runtime, TypeScript (hexagonal)

**Byte-identical application source** to `../node-express` (domain/, adapters/,
infra/, main.ts, tests/, tsconfig.json) — swapping only the runtime (Node 24 →
Bun) per the experiment, zero application-code rewrite. Bun runs the `.ts` files
natively; `tsc --noEmit` (via `npm run typecheck`) is the type-checker.

## Layout

Identical to `../node-express` (see its README): `main.ts` composition root +
`domain/` (models, errors, ports, workflows) + `adapters/` (http, postgres) +
`infra/config.ts` + `tests/`.

## Run

```bash
bun install
bun run typecheck            # tsc --noEmit
bun test                     # or: node --test tests/
PORT=3001 DATABASE_URL=postgres://app:app@localhost:5432/app bun run main.ts
```

## Docker

```bash
docker compose up -d --build
# Traefik routes /bun → bun:3001 (prefix stripped)
curl -i -H "Authorization: Bearer 7" http://localhost/bun/api/feed
```