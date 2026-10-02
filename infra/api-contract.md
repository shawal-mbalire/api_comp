# API Contract (identical across all 8 stacks)

Every backend in the 8 root stack folders (`rust-axum`, `go-stdlib`, …) implements
**exactly** the same HTTP API so the benchmark is a fair comparison of the
runtime/framework, not of endpoint design.

This contract is the source of truth. Implementations MUST follow it verbatim —
endpoint paths, status codes, JSON field names, SQL semantics, pool sizing.

## Conventions

- Encoding: JSON, `application/json`.
- Post/User timestamps are returned as ISO-8601 UTC strings (`YYYY-MM-DDTHH:MM:SS.mmmZ`).
- JSON uses **camelCase** field names, as shown below.
- No ORM, no external cache (no Redis/Memcached). Only the raw database driver +
  a connection pool.
- Connection pool size must be **exactly 10 per process** (the experiment's hard
  limit). For multi-worker runtimes (Uvicorn 3 workers, FrankenPHP 10 threads)
  each worker/process gets its own pool of 10.

## Environment variables

| Variable         | Meaning                                        | Example                                        |
|------------------|------------------------------------------------|------------------------------------------------|
| `PORT`           | TCP port the HTTP server binds                 | `8080`                                         |
| `DATABASE_URL`   | PostgreSQL connection string                   | `postgres://app:app@db:5432/app`               |
| `POOL_SIZE`      | Max connections per process (default/forced 10)| `10`                                           |

## Authentication (benchmark simplification)

Each request carries `Authorization: Bearer <user_id>` — for benchmark purposes the
bearer token **is** the acting user's numeric id. Endpoints that need the acting
user read it from this header. A missing/malformed header returns `401`.

> Rationale: a real token table would add an identical per-request lookup to every
> stack; using the id directly removes that constant without changing relative
> ranking. Documented, reproducible simplification.

## Endpoints

### `GET /health`
Return `200` with `{"status":"ok"}`. Used by orchestration/healthchecks.

### `GET /api/me`
Acting user from bearer token.
`200`:
```json
{ "id": 7, "username": "user_000007", "displayName": "Ada Lovelace" }
```

### `GET /api/feed`
The 20 newest posts with author details and like counts. Ordered by
`posted_at DESC, id DESC`.
`200`: array of post objects (see shape below).

### `GET /api/posts/{id}`
Single post. `200` with a post object; `404` with `{"error":"not found"}` if unknown id.

### `POST /api/posts/{id}/like`
The acting user likes the post. Insert into `likes`, silently ignore duplicates
(`ON CONFLICT DO NOTHING`). Returns `204 No Content`. `404` if the post id does not exist.

### `POST /api/posts`
Body: `{"content":"..."}` (required, non-empty string). Creates a post for the
acting user. Returns `201` with the full created post object. `400` on missing/empty content.

## Post object shape

```json
{
  "id": 123456,
  "userId": 7,
  "username": "user_000007",
  "displayName": "Ada Lovelace",
  "content": "…post text…",
  "postedAt": "2026-07-01T12:00:00.000Z",
  "likeCount": 42
}
```

## Shared SQL (raw, identical across stacks)

```sql
-- feed (20 newest)
SELECT p.id, p.user_id, u.username, u.display_name, p.content, p.posted_at,
       (SELECT count(*) FROM likes l WHERE l.post_id = p.id) AS like_count
FROM posts p
JOIN users u ON u.id = p.user_id
ORDER BY p.posted_at DESC, p.id DESC
LIMIT 20;

-- single post
SELECT p.id, p.user_id, u.username, u.display_name, p.content, p.posted_at,
       (SELECT count(*) FROM likes l WHERE l.post_id = p.id) AS like_count
FROM posts p
JOIN users u ON u.id = p.user_id
WHERE p.id = $1;

-- like (idempotent)
INSERT INTO likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- create post
INSERT INTO posts (user_id, content) VALUES ($1, $2) RETURNING id, posted_at;

-- me
SELECT id, username, display_name FROM users WHERE id = $1;
```

## Per-stack server configuration (fixed by the experiment)

Traefik routes each stack by path prefix and strips it, so all stacks serve the
identical URIs. Each stack also runs with exactly `POOL_SIZE` (10) connections
per process and its own port inside the compose network.

| Stack            | Dir                 | Prefix   | Port | Notes |
|------------------|---------------------|----------|------|-------|
| Rust (Axum)      | `rust-axum`         | `/rust`  | 8082 | SQLx, tokio. Pool 10. |
| Go (net/http)    | `go-stdlib`         | `/go`    | 8081 | pgx pool 10. |
| Java (Spring 3)  | `java-spring`       | `/java`  | 8080 | MVC + Tomcat, JdbcTemplate, Hikari max 10. |
| C# (ASP.NET Core)| `dotnet`            | `/dotnet`| 5000 | Minimal API, Npgsql pool 10. |
| Bun (Hono on Bun) | `bun`        | `/bun`   | 3001 | Hono on Bun's native HTTP server (web-standard, no Express); pool 10. |
| Node (Express 5) | `node-express`      | `/node`  | 3000 | Single process, pool 10. |
| Python (FastAPI) | `python-fastapi`    | `/fastapi` | 8000 | Uvicorn 3 workers, pool 10 each. |
| PHP (Laravel 13) | `php-laravel`       | `/php`   | 9000 | FrankenPHP classic mode, 10 threads (each keeps one persistent PDO connection), OPcache + route cache. |

Each stack implements this contract with **Hexagonal Architecture** (domain →
ports → adapters; see the per-stack READMEs) while preserving exact SQL behavior.

## Structural notes

- **Auth on `GET /api/feed` and `GET /api/posts/{id}`:** all `/api/*` endpoints
  require the bearer token (except `/health`) — enforced by the HTTP adapter in
  every stack, and the k6 harness always sends the header.
- **400 message bodies:** endpoints return `{"error":"bad request"}` /
  `{"error":"content required"}`; the smoke test asserts status codes only.
- **`postedAt`:** ISO-8601 UTC, millisecond precision (`....Z`).