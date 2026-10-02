# Feed API — Rust (Axum + SQLx, hexagonal)

Rust backend for the multi-language benchmark. Axum 0.8 + Tokio + SQLx
(PostgreSQL driver, runtime queries only — no ORM, no `query!` macros, no
external cache). Implements `../infra/api-contract.md` exactly.

- Port: **8082**
- Connection pool: exactly `POOL_SIZE` (default `10`) per process.
- Config via env: `PORT`, `DATABASE_URL`, `POOL_SIZE`.

## Hexagonal layout

```
rust-axum/
├── src/
│   ├── main.rs              # composition root (config → pool → repo → service → router → serve)
│   ├── domain/              # pure application logic — zero framework imports
│   │   ├── models.rs        # User, Post (pure data, snake_case internally)
│   │   ├── errors.rs        # FeedError (BadRequest / NotFound / Database) + .code()
│   │   ├── ports.rs         # FeedRepository trait (async, dyn-compatible, Send + Sync)
│   │   └── workflows.rs     # FeedService — validate raw input → drive the port (+ unit tests)
│   ├── adapters/
│   │   ├── http.rs          # driving adapter: Axum handlers, Bearer auth, camelCase DTOs
│   │   └── postgres.rs      # driven adapter: raw SQL from the contract, row → domain map
│   └── infra/
│       └── config.rs        # typed config from env (only place env vars are read)
├── Cargo.toml
├── (image built inline in docker-compose.yml)
└── README.md
```

Dependencies point inward: `domain` knows only its ports; `adapters` implement
them. Swapping PostgreSQL for another store means adding one adapter — the
domain never changes. Raw `sqlx::Error` values are wrapped into
`FeedError::Database` at the adapter boundary and never cross into workflows.

## Run

Requires Rust (edition 2021) and a reachable PostgreSQL.

```bash
cargo build --release

PORT=8082 \
DATABASE_URL=postgres://app:app@localhost:5432/app \
POOL_SIZE=10 \
./target/release/backend-rust-axum
```

Or, with the env vars already exported:

```bash
cargo run --release
```

Health check: `curl http://localhost:8082/health` → `{"status":"ok"}`

## Test

```bash
cargo test     # unit tests in domain/workflows.rs against an in-memory fake repo
```

## Docker (docker compose)

The `rust` service is already wired in `docker-compose.yml`. Traefik routes
`/rust` → rust:8082 and strips the prefix (the backend sees `/api/...`):

```bash
docker compose up -d --build
```

## Endpoints

| Method | Path                    | Status | Notes                                    |
|--------|-------------------------|--------|------------------------------------------|
| GET    | `/health`               | 200    | `{"status":"ok"}`, no auth               |
| GET    | `/api/me`               | 200/401/404 | acting user from `Bearer <id>`     |
| GET    | `/api/feed`             | 200/401| 20 newest posts (author + like count)    |
| GET    | `/api/posts/{id}`       | 200/400/404 | single post                      |
| POST   | `/api/posts/{id}/like`  | 204/400/404 | idempotent like                  |
| POST   | `/api/posts`            | 201/400/401 | create post (`{"content":"..."}`)  |

Auth (benchmark simplification): every `/api/*` request must carry
`Authorization: Bearer <user_id>`, where the token **is** the acting user id.