# Agents — how this repo was built by AI agents

This monorepo is a language/framework API comparison built with a multi-agent
workflow. Foundation files (Traefik compose, OpenAPI contract, DB schema + seed,
k6 harness, binary-search runner, docs) were written by the orchestrator. Each
of the 8 stacks was implemented by a dedicated subagent working from the
**single source of truth** `infra/api-contract.md`, then re-organized into
**Hexagonal Architecture** (pure `domain/` + ports + `adapters/` + `infra/` +
root composition root + `tests/`).

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
contract guaranteed parity. `node-express` + `bun` are byte-identical by design
(the experiment's zero-rewrite runtime swap) and were written directly.

## Agent ledger

| Stack | Hexagonal structure | Verification |
|---|---|---|
| `rust-axum` | `src/main.rs` (root) · `src/domain/{models,errors,ports,workflows}.rs` · `src/adapters/{http,postgres}.rs` · `src/infra/config.rs` | ✅ `cargo build --release` (0 warnings) + `cargo test` 12/12 |
| `go-stdlib` | `main.go` (root) · `domain/` (models·errors·ports·workflows) · `adapters/` (postgres·http) · `infra/config` · `tests/` | ✅ `go build`/`go vet`/`go test` + live Traefik smoke 14/14 |
| `java-spring` | `dev.bench` root (composition root) · `domain/{models,errors,ports,workflows}` · `adapters/{http,postgres}` · `infra/config` | ✅ `mvn package` (BUILD SUCCESS) + `mvn test` 7/7 |
| `dotnet` | `Program.cs` (root) · `Domain/` · `Adapters/` (Http, PostgresFeedRepository) · `Infra/Config.cs` · `Tests/` (xunit, fake repo) | ✅ inline image builds (SDK 10) · ⚠️ local unit test run pending (no SDK on host) |
| `bun` | identical to `node-express` (runtime swap only) | coverage via node-express |
| `node-express` | `main.js` (root) · `domain/` · `adapters/{postgres,http}` · `infra/config` · `tests/` | ✅ `node --test` 7/7 + live Traefik smoke 14/14 |
| `python-fastapi` | `main.py` (root) · `domain/` · `adapters/` · `infra/config` · `tests/` (3.14-slim) | ✅ `unittest` 6/6 + py_compile |
| `php-laravel` | `app/Domain/{Models,Errors,Ports,Workflows}` · `app/Adapters/PostgresFeedRepository` · `app/Http/Controllers/ApiController` (driving) · `AppServiceProvider` (composition root) · FrankenPHP runtime | ✅ 13 PHP files `php -l` clean · ⚠️ inline image smoke pending |

## Contract parity rules enforced for every agent

1. `infra/api-contract.md` + `infra/openapi.yaml` + `infra/schema.sql` are the
   source of truth; never invent endpoints.
2. Identical raw SQL (placeholders may adapt to the driver: `$1` ↔ `?`).
3. Exact status codes (`200/201/204/400/401/404`), camelCase JSON, ISO-8601 UTC
   timestamps.
4. **No ORM, no external cache, pool = exactly `POOL_SIZE` (10) per process.**
5. One process per container, one job per compose service. Traefik owns all
   networking/routing; Postgres is a pure database. Never override the compose
   network responsibilities inside a service.
6. Hexagonal: domain never imports frameworks/DB; adapters implement ports;
   `infra/config` is the only env reader; entry point = composition root.
7. **No shell scripts.** All tooling is Python (`infra/*.py`, inline shebangs in
   the justfile) or the justfile itself.

## Verification matrix (Oct 2026 — mega `docker compose up -d --build` in progress)

| Stack | Local build/test | Inline image build | Live contract (smoke-test 14 checks) |
|---|---|---|---|
| node-express | ✅ | ✅ (node:24-slim) | ✅ via Traefik `/node` (earlier stack) |
| go-stdlib | ✅ | building (golang:1.27) | ✅ via Traefik `/go` (earlier stack) |
| rust-axum | ✅ cargo | building (rust:slim) | pending (fresh DB + run) |
| java-spring | ✅ mvn | building (temurin 25) | pending |
| python-fastapi | ✅ unittest | building (3.14-slim) | pending |
| dotnet | ✅ image only | ✅ (SDK 10 → aspnet 10) | pending |
| bun | ✅ (shared app) | building (bun:1-slim) | pending |
| php-laravel | ✅ php -l 13 files | building (frankenphp php8.4) | pending |

## Follow-ups

- Finish the mega stack build: `just up` — wait for all 8 images, then seed a
  fresh Postgres (`just seed` → `infra/seed.py`) and smoke-test every prefix:
  `just smoke <stack>` / `just check`.
- Run `just bench <stack>` per stack; collect `infra/metrics/<stack>.md`
  against the reference numbers in `README.md`.
- (Optional) install a .NET 10 SDK on the host to run `dotnet test
  Tests/Apicomp.Tests.csproj` for the dotnet unit tests.
- Keep the agents' canonical prompts (in the session log) as the regeneration
  template — a new stack (or a migrated one) must pass the parity rules above.