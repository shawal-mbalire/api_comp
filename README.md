# api_comp — API Language & Framework Comparison

A runnable, reproducible benchmark comparing **8 backend runtimes** serving an
identical Twitter-style REST API, replicating and extending the experiment from
Arjay McCandless's *"I Tested 8 Programming Languages on a $12 Server"*
([video](https://www.youtube.com/watch?v=sQXFhh_PiG4)).

**Pass criteria:** P95 < 500 ms · P99 < 1 s · error rate < 1%.

## Architecture

- **Traefik is the only proxy — no nginx anywhere.** Every stack and the Traefik
  config are defined **inline in `docker-compose.yml`** (`dockerfile_inline:`
  blocks; no Dockerfiles, no config files). Traefik routes each stack by path
  prefix (`/rust`, `/go`, `/java`, `/dotnet`, `/bun`, `/node`, `/fastapi`,
  `/php`) with a `stripPrefix` middleware, so every backend serves the
  **identical** contract URIs (`/api/feed`, `/api/posts/...`, …).
- **Postgres is a pure database** — credentials/healthcheck/volume inline in
  compose; **one schema file** (`schema.sql` in `infra/`) auto-applied on fresh volumes.
- **8 single-purpose services, one process each, one thing each.** Everything is
  **Hexagonal Architecture**: a pure `domain/` (models, errors, ports,
  workflows), `adapters/` (HTTP driving + Postgres driven), `infra/` (config),
  and a root composition root. Swapping Postgres for SQLite (the video's
  follow-up experiment) = adding one adapter; the domain never changes.
- **Laravel runs on FrankenPHP** (single binary = Caddy + embedded PHP, HTTP on
  :9000, classic per-request boot).
- **Latest, language-specific slim images**: `traefik:latest`, `postgres:latest`,
  `node:24-slim`, `oven/bun:1-slim`, `python:3.14-slim`, `golang:1.27`,
  `rust:slim`, `eclipse-temurin:25-jre`, `dotnet/sdk:10.0` + `aspnet:10.0`,
  `composer:latest`, `dunglas/frankenphp:php8.4`.

## Repository layout — exactly 8 folders (one per language) + root files

```
.
│  ── 9 folders ─────────────────────────────────────────────────────────
├── rust-axum/          # 8 language stacks
├── go-stdlib/
├── java-spring/
├── dotnet/
├── bun-express/
├── node-express/
├── python-fastapi/
├── php-laravel/
│       (each: composition root + domain/ + adapters/ + infra/ + tests/)
└── infra/              # everything else, consolidated
    ├── schema.sql      # the one DB schema file (auto-applied by Postgres init)
    ├── seed.py         # dataset generator + DB seeder (50k/500k/2M) — pure Python
    ├── traffic/benchmark.js  # k6 virtual-user loop (traffic generation)
    ├── metrics/        # benchmark outputs: <stack>.md + k6 summary JSON
    ├── benchmark.py    # binary-search + 5-min confirmation runner
    ├── smoke-test.py   # contract-conformance checks (14)
    ├── openapi.yaml    # OpenAPI 3.0 contract
    ├── api-contract.md # authoritative behavior spec (single source of truth)
    └── acme.json, .env.example
│  ── 4 root files ──────────────────────────────────────────────────────
├── docker-compose.yml  # everything inline: traefik + db config + 8 images
├── justfile            # the command surface (just up | seed | smoke | bench …)
├── agents.md           # how the repo was built with AI agents
└── README.md
```

## Quick start (no shell — `just` + Python)

```bash
# 1) Tooling: Docker 24+ / Compose v2, Python 3, k6, and just
#    brew install just         (see https://just.systems)

# 2) Launch EVERYTHING with ONE command: Traefik + Postgres + all 8 stacks
just up

# 3) Seed the database (50k users / 500k posts / 2M likes)
just seed

# 4) Sanity checks (Traefik routes /go → go:8081 and strips the prefix)
curl -i http://localhost/go/health
curl -i -H "Authorization: Bearer 7" http://localhost/go/api/feed

# 5) Contract conformance test per stack (14 checks) or all stacks
just smoke go          # one stack
just check             # all 8 concurrently

# 6) Run the benchmark: warm-up → 2-min binary search → 5-min confirmation
just bench go          # per-stack report → infra/metrics/go.md

# 7) Unit tests per stack (fake repos, no DB)
just test              # all stacks / just test rust
```

Every command above delegates to Python (`infra/*.py`) or an inline Python
shebang in the justfile — there are no shell scripts in this repo.

### All 8 stacks are always running

One `docker compose up -d` starts every service; Traefik routes each stack under
its own prefix: `/rust`, `/go`, `/java`, `/dotnet`, `/bun`, `/node`,
`/fastapi`, `/php`. Target a stack via its prefix (e.g.
`http://localhost/rust/api/feed`); on constrained hosts stop the others with
`docker compose stop rust bun dotnet fastapi php java node`.

Traefik's dashboard is at `http://localhost:8080/dashboard/` (local only).

### Environments

No per-stack env is required: routing is fixed per prefix in `docker-compose.yml`
and each service receives `PORT`, `DATABASE_URL`, `POOL_SIZE` from its service
definition.

## Reference results (the video's baseline)

Single $12 VPS: 1 shared CPU / 2 GB RAM / 50 GB SSD, co-located proxy + app +
PostgreSQL. Pass criteria: P95 < 500 ms, P99 < 1 s, errors < 1 %.

| Rank | Stack | Concurrent users | Req/s | Key takeaways |
|---|---|---|---|---|
| 1 | **Rust** (Axum + SQLx) | **6,900** | ~640 | Top performer; CPU load shifted almost entirely onto Postgres. |
| 2 | **Go** (net/http) | **6,500** | >600 | Doubled Node's results; virtually tied with Rust. |
| 3 | **Java** (Spring Boot 3, MVC) | **5,100** | ~500 | Excellent; JVM RAM peaked ~600 MB. |
| 4 | **C#** (ASP.NET Core) | **4,400** | — | Solid run; DB driver defaults added query overhead. |
| 5 | **Bun** (Express) | **4,200** | ~389 | ~30 % boost over Node, zero application-code rewrite. |
| 6 | **Node 22 + Express 5** | **3,250** | ~300 | Baseline reference; single process. |
| 7 | **Python** (FastAPI + Uvicorn) | **2,150** | ~200 | Failed above 2.3k: DB pool connection timeouts (>5 s). |
| 8 | **PHP** (Laravel 13 + PHP-FPM) | **750** | ~94 | Per-request framework boot cost bottlenecked FPM. |

**Key insights**

1. PHP: Laravel boots the framework per request — Octane raised it to ~1,250
   users, bare PHP to **2,700**.
2. At Go/Rust throughput the app's CPU dropped to ~22–24 % while Postgres took
   ~60 % — the database is the bottleneck.
3. SQLite (no network/DB IPC) re-test of the top three: **Rust 14,500** users
   (~1,300 RPS, ~5 ms median), **Go 11,750**, **Java 10,250**.
4. Sustained 5-min runs exposed Node degrading 3,750 → 3,250, which short runs missed.

## Methodology (how this repo reproduces it)

- **Hardware baseline:** 1 shared CPU / 2 GB RAM / 50 GB SSD, co-located Traefik
  + app + PostgreSQL.
- **Data:** Twitter-style API, `schema.sql`; pre-seeded ~150–350 MB
  (50k users / 500k posts / 2M likes) via `infra/seed.py`.
- **Rules:** strictly **10 pooled connections per process**, plain SQL, **no ORM**,
  **no external cache**.
- **Workload:** 1 virtual user = loop of 4 actions (feed → open post → like →
  create post) with **3–7 s pacing** (≈0.1–0.2 req/s per user);
  `infra/traffic/benchmark.js`.
- **Protocol:** warm-up at 1,000 users → doubling 2-min runs from 2,500 until
  failure → binary search to the boundary → mandatory **5-min confirmation** run.
  Implemented end-to-end by `infra/benchmark.py` (reports in `infra/metrics/`).

## Fair-comparison rules (enforced)

- Identical endpoints / raw SQL / JSON per `infra/api-contract.md` + `infra/openapi.yaml`.
- **Pool size exactly 10 per process; no ORM; no external cache.**
- Identical virtual-user loop, pass criteria, and binary-search protocol.
- Benchmark-simplified auth: `Authorization: Bearer <user_id>`.

## Production realism ("baseline ≠ production")

The baseline mirrors the video's single-node setup; real deployments diverge:

1. **Separate app and DB** — co-locating proxy+app+Postgres on one core causes
   CPU starvation/IPC overhead; move Postgres to its own instance (RDS/managed).
2. **Real network latency & TLS** — loopback latency is <0.1 ms; run k6 from
   another region (30–100 ms) and terminate TLS on every request.
3. **ORMs & caching** — ORMs (Hibernate, Prisma, Eloquent, SQLAlchemy…) add
   query-generation/hydration overhead; Redis/Memcached change read paths.
4. **Multi-core & clustering** — single-process / default workers understate
   modern hosts; use Node `cluster`/PM2 and CPU/memory-tuned worker counts.
5. **Operational conditions** — background workers (Celery/Sidekiq/BullMQ),
   rate-limiting/CORS/validation/tracing/logging middleware, and PgBouncer-style
   pooling proxies.

Each backend in this repo is a self-contained hexagonal app, so production-shaped
variants (ORM/cache/middleware) can be added and A/B-compared on equal footing.

## How it was built

See `agents.md` — 8 dedicated subagents built the stacks from the shared
`api-contract.md`, then everything was re-organized into hexagonal architecture,
inline images, and this 8-folder layout.