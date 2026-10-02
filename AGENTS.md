# Agents — how this repo was built by AI agents

This monorepo is a language/framework API comparison built with a multi-agent
workflow. Foundation files (Traefik compose, OpenAPI contract, DB schema + seed,
k6 harness, binary-search runner, docs) were written by the orchestrator. Each
of the 8 stacks was implemented by a dedicated subagent working from the
**single source of truth** `infra/api-contract.md`, then re-organized into
**Hexagonal Architecture** (pure `domain/` + ports + `adapters/` + `infra/` +
root composition root + `tests/`).

The intro of every stack subagent prompt **loads the `hexagonal-architecture`
skill** (canonical reference for the layer layout, port taxonomy, and structure
rules) **and the `justfile` skill** (nested-monorepo justfiles), and the subagent
**delivers a self-contained `justfile` per stack folder** (root router +
self-contained children).

## Architecture (current)

- **Traefik is the only proxy — no nginx anywhere.** Traefik config and all
  8 stack images live **inline in `docker-compose.yml`** (the `command:` array
  for Traefik, `dockerfile_inline:` blocks for every stack). No Dockerfiles, no
  `Caddyfile`, no `*.conf` files in the repo.
- **Mega compose:** one `docker compose up -d --build` starts Traefik + Postgres
  + all 8 API services. Traefik routes each stack by path prefix
  (`/rust`, `/go`, `/java`, `/dotnet`, `/bun`, `/node`, `/fastapi`, `/php`) and
  strips the prefix — every backend serves identical contract URIs.
- **Postgres is a pure database.** Each API service runs one process doing one
  thing.
- **API services are pure, minimal APIs.** A stack does exactly one job: serve
  the contract's HTTP endpoints. It performs no networking of its own — no TLS,
  no routing, no prefix stripping, no static hosting; Traefik owns all of that.
  It performs no database functionality of its own — no schema management, no
  migrations, no DB hosting; Postgres owns persistence. The service only opens
  its `POOL_SIZE` Postgres connection pool and answers requests.
- **Docker handles replicas.** Every stack is stateless, so Docker Compose can
  scale any service horizontally (`docker compose up -d --scale <service>=N`)
  with no code changes. Never build instance-count or leader assumptions into
  an API.
- **Latest, language-specific slim images** (prefer slim over alpine, no
  distro-flavored tags): `traefik:latest`, `postgres:latest`,
  `node:24-slim`, `oven/bun:1-slim`, `python:3.14-slim`, `golang:1.27`,
  `rust:slim`, `eclipse-temurin:25-jre`, `dotnet/sdk:10.0`+`aspnet:10.0`,
  `composer:latest`, `dunglas/frankenphp:php8.4`.
- **Laravel runs on FrankenPHP** (single binary = Caddy + embedded PHP, HTTP on
  :9000, classic per-request boot) — the previous nginx+fpm glue is gone.

## Why per-stack agents

All eight stacks must implement the same API, same SQL, same pool rules. Isolated
agents avoided cross-implementation interference while an explicit shared
contract guaranteed parity. `ts-express` (Express 5) and `ts-hono` (Hono on Bun's
native HTTP server — no Express) share their hexagonal `domain/` + Postgres
adapter byte-identical and were written directly; only the HTTP driving adapter
differs.

## Port patterns: Repository vs Gateway

Ports in this repo are named by the boundary they draw. Choose the name for an
adapter family by **whose data or contract is on the other side of the port**:

- **`*Repository` — the domain's own data.** The port abstracts **storage of
  data the domain owns**: the rows/aggregates whose shape and lifecycle are
  yours. Methods are named after domain concepts (`findByUserId`, `feed`,
  `findPostById`, `like`, `createPost`), and the adapter owns the SQL plus the
  row↔domain mapping. **Use a Repository when swapping the storage backend is
  the reason for the port** (Postgres ↔ SQLite, same data, zero domain
  changes). In this repo every stack's one port is a Repository —
  `FeedRepository` → `PostgresFeedRepository`.
- **`*Gateway` — a foreign system.** The port wraps an **external capability
  the domain does not own**: a third-party REST/gRPC API, a message broker, a
  payment or auth provider, another service's protocol. The adapter translates
  that foreign request/response protocol into domain calls, and the
  protocol/endpoints live in the adapter's injected config — **never in the
  port signature**. **Use a Gateway when swapping the transport or vendor is
  the reason for the port** (Stripe ↔ Adyen, HTTP ↔ gRPC, stub ↔ live API).

> **Decision shortcut: whose contract is it?** "Ours — we're deciding how to
> store it" → **Repository**. "Theirs — we're calling into their system" →
> **Gateway**. (Applies to the `hexagonal-architecture` skill's port taxonomy:
> persistence → `*Repository`, external APIs → `*Gateway`.) This repo has only
> a Repository today; introduce a Gateway the moment a stack must reach outside
> Postgres.

## Agent ledger

| Stack | Hexagonal structure | Verification |
|---|---|---|
| `rust-axum` | `src/main.rs` (root) · `src/domain/{models,errors,ports,workflows}.rs` · `src/adapters/{http,postgres}.rs` · `src/infra/config.rs` | ✅ `cargo build --release` (0 warnings) + `cargo test` 12/12 |
| `go-gin` | `main.go` (root) · `domain/` (models·errors·ports·workflows) · `adapters/` (postgres·http(Gin)) · `infra/config` · `tests/` (workflows + httptest) | ✅ `go build`/`go vet`/`go test` (domain + Gin routes) + live Gin smoke |
| `java-spring` | `dev.bench` root (composition root) · `domain/{models,errors,ports,workflows}` · `adapters/{http,postgres}` · `infra/config` | ✅ `mvn package` (BUILD SUCCESS) + `mvn test` 7/7 |
| `cs-dotnet` | `Program.cs` (root) · `Domain/` · `Adapters/` (Http, PostgresFeedRepository) · `Infra/Config.cs` · `Tests/` (xunit, fake repo) | ✅ inline image builds (SDK 10) · ⚠️ local unit test run pending (no SDK on host) |
| `ts-hono` | `main.ts` (root) · `domain/{models,errors,ports,workflows}.ts` · `adapters/{http(Hono),postgres}.ts` · `infra/config.ts` · `tests/` (bun:test + `app.request` HTTP tests) | ✅ `tsc --noEmit` + `bun test` 15/15 + live Bun serve smoke |
| `ts-express` | `main.ts` (root) · `domain/{models,errors,ports,workflows}.ts` · `adapters/{postgres,http}.ts` · `infra/config.ts` · `tests/` (strict TS, `tsc --noEmit` + `node --test`) | ✅ `tsc --noEmit` + `node --test` 7/7 + live Traefik smoke 14/14 |
| `python-fastapi` | `main.py` (root) · `domain/` · `adapters/` · `infra/config` · `tests/` (3.14-slim) | ✅ `unittest` 6/6 + py_compile |
| `php-laravel` | `app/Domain/{Models,Errors,Ports,Workflows}` · `app/Adapters/PostgresFeedRepository` · `app/Http/Controllers/ApiController` (driving) · `AppServiceProvider` (composition root) · FrankenPHP runtime | ✅ 13 PHP files `php -l` clean · ⚠️ inline image smoke pending |

## Contract parity rules enforced for every agent

1. `infra/api-contract.md` + `infra/openapi.yaml` + `infra/schema.sql` are the
   source of truth; never invent endpoints.
2. Identical raw SQL (placeholders may adapt to the driver: `$1` ↔ `?`).
3. Exact status codes (`200/201/204/400/401/404`), camelCase JSON, ISO-8601 UTC
   timestamps.
4. **No ORM, no external cache, pool = exactly `POOL_SIZE` (10) per process.**
5. **Pure, minimal API per container.** One process per container, one job per
   compose service. A stack does no networking itself (no TLS, no routing, no
   prefix-stripping, no static files — Traefik owns all of it) and no database
   functionality itself (no schema management, no migrations, no DB hosting —
   Postgres owns persistence). Never override the compose network
   responsibilities inside a service.
6. Hexagonal: domain never imports frameworks/DB; adapters implement ports;
   `infra/config` is the only env reader; entry point = composition root. Name
   each port by its boundary — `*Repository` when the domain owns the data,
   `*Gateway` when it wraps a foreign system (see "Port patterns" above).
7. **No shell scripts.** All tooling is Python (`infra/*.py`, inline shebangs in
   the justfiles) or the justfiles themselves.
8. **Prefer the `hexagonal-architecture` skill.** Every stack agent loads the
   `hexagonal-architecture` skill before touching code and treats it as the
   canonical reference for the layer split (`domain/` + `adapters/` + `infra/` +
   `tests/`), file placement, ports-only-when-they-earn-it, and workflows-read-
   like-pseudocode. This doc only summarizes repo specifics; the skill wins on
   any architectural detail.
9. **One self-contained `justfile` per stack folder — written with the
   `justfile` skill.** Every stack agent loads the `justfile` skill before
   writing its stack justfile (same discipline as rule 8 for hexagonal) and
   follows its UX rules: space-separated subcommands (`just build`, `just
   test`), silent `@`-prefixed one-liners for trivial recipes, inline
   `#!/usr/bin/env python3` shebang bodies for any logic (no external script
   files), children fully self-contained (never `import` the root). The root
   `justfile` is a thin router whose recipes `cd` into each folder —
   `just <stack> <recipe>` — per the skill's nested-monorepo pattern.
10. **Stateless for Docker replicas.** Every API is stateless — no in-process
    state shared across requests, no leader/instance-count assumptions. Docker
    Compose owns scaling (`--scale` / replicas); a service must behave
    correctly at any replica count with zero code changes.
11. **TypeScript for the Node/Bun stacks — and strong types.** `ts-express`
    (Express 5) and `ts-hono` (Hono on Bun's native HTTP server — **no Express**)
    are TypeScript (`.ts`, ESM) with **no emitted JS**
    anywhere: Node 24+ strips types natively and Bun runs `.ts` natively, so
    `tsc --noEmit` (strict) is a type-checker only (`just typecheck`; the
    `typescript` + `@types/*` devDependencies are not needed at runtime and the
    images install with `--omit=dev`). Rules: `strict: true`,
    `noUncheckedIndexedAccess`, explicit types on every function surface, no
    `any`, `import type` for type-only imports, relative imports carry the
    `.ts` extension, `erasableSyntaxOnly` (no enums/namespaces/parameter
    properties). If a type doesn't fit, model it — don't escape to `any`.
12. **No logic-overloaded statements — use variables.** Break dense inline
    expressions (long ternaries, chained `??`/`&&`, compound boolean
    conditions, deeply nested calls) into well-named local variables so each
    statement reads like prose. If you have to pause to parse a line, extract
    part of it into a variable (e.g. the acting user id, a FK-violation flag,
    a DTO field). This applies to every language in the repo, not just TS.

## Verification matrix (Oct 2026 — mega `docker compose up -d --build` in progress)

| Stack | Local build/test | Inline image build | Live contract (smoke-test 14 checks) |
|---|---|---|---|
| ts-express | ✅ | ✅ (node:24-slim) | ✅ via Traefik `/node` (earlier stack) |
| go-gin | ✅ go test (Gin route tests via httptest) | building (golang:1.27) | ✅ via Traefik `/go` (earlier stack) |
| rust-axum | ✅ cargo | building (rust:slim) | pending (fresh DB + run) |
| java-spring | ✅ mvn | building (temurin 25) | pending |
| python-fastapi | ✅ unittest | building (3.14-slim) | pending |
| cs-dotnet | ✅ image only | ✅ (SDK 10 → aspnet 10) | pending |
| ts-hono | ✅ `bun test` 15/15 + `tsc --noEmit` (Hono on Bun, no Express) | building (bun:1-slim) | pending |
| php-laravel | ✅ php -l 13 files | building (frankenphp php8.4) | pending |

## Contract-parity decisions (Oct 2026 audit)

These were fixed repo-wide so all 8 stacks behave identically — a new stack (or a
migrated one) must match them, not just the contract text:

- **`postedAt` is exactly `YYYY-MM-DDTHH:MM:SS.mmmZ`** (fixed 3-digit millisecond
  UTC). The smoke test now enforces the regex; Go must not use `RFC3339Nano`
  (it strips trailing zeros) and .NET must not use `"O"` (7 digits).
- **Every 400/401/404 body is `{"error": <message>}`** — never FastAPI's
  `{"detail": ...}` and never a 422 (missing/empty body → 400).
- **Bearer token = a bare positive integer**: `Bearer <digits>` with value > 0.
  `0`, floats, hex, exponents, and surrounding whitespace are all malformed → 401.
- **Acting-user FK violations on like/create → 404** (not 500): each Postgres
  adapter maps SQLSTATE `23503` to `NotFoundError`.
- **PHP pool = exactly POOL_SIZE (10)**: the inline FrankenPHP Caddyfile pins
  `num_threads 10` + `max_threads 10` and each thread holds one persistent PDO
  connection. No FPM anywhere; comments must not say FPM.
- **cs-dotnet trims post content** on create (like every other stack).

## Follow-ups

- Finish the mega stack build: `just up` — wait for all 8 images, then seed a
  fresh Postgres (`just seed` → `infra/seed.py`) and smoke-test every prefix:
  `just smoke <stack>` / `just check`.
- Add one self-contained `justfile` per stack folder (`rust-axum/justfile`,
  `go-gin/justfile`, …, per rule 9) with `build`/`test`/basic recipes, and
  wire the root router so `just <stack> <recipe>` works end-to-end.
- Run `just bench <stack>` per stack; collect `infra/metrics/<stack>.md`
  against the reference numbers in `README.md`.
- (Optional) install a .NET 10 SDK on the host to run `dotnet test
  Tests/Apicomp.Tests.csproj` for the cs-dotnet unit tests.
- Keep the agents' canonical prompts (in the session log) as the regeneration
  template — a new stack (or a migrated one) must load the
  `hexagonal-architecture` + `justfile` skills and pass the parity rules above.