# Feed API — Laravel 13 on FrankenPHP (hexagonal)

Benchmark backend for the 8-language API comparison. Implements `../infra/api-contract.md`.

## Architecture

```
Traefik (:80, /php rule + stripPrefix) ──►  FrankenPHP (HTTP :9000)
                                              │ single binary = Caddy + embedded PHP
                                              │ classic mode (framework boots per request)
                                              └── pdo_pgsql → Postgres (:5432)
```

- **No nginx anywhere — Traefik is the only proxy.** Laravel is served by
  **FrankenPHP**: one binary (Caddy HTTP server with embedded PHP) speaking HTTP
  directly on **PORT (9000)**. One process, one job. The image (`dunglas/
  frankenphp:php8.4`) and its Caddyfile are defined **inline in
  `docker-compose.yml`** (`dockerfile_inline`).
- **OPcache** (JIT, `validate_timestamps=0`) and **route config cache** are baked
  into the image at build time.
- Classic mode boots the framework per request — behaviorally comparable to the
  video's PHP-FPM baseline (that's where the "framework boot cost" finding comes
  from). Worker mode (Octane-style) is a one-line Caddyfile change.
- **No Eloquent, no ORM objects, no external cache** — raw SQL through the `DB`
  facade (PDO) using the exact contract queries.

## Hexagonal layout (app code)

```
php-laravel/
├── routes/                       # web.php (/health) + api.php (framework glue)
├── bootstrap/app.php             # withRouting(web:, api:, ...)
├── app/
│   ├── Domain/                    # pure application logic (no Laravel/DB imports)
│   │   ├── Models/    User.php, Post.php
│   │   ├── Errors/    BadRequestError.php, NotFoundError.php
│   │   ├── Ports/     FeedRepository.php          (interface)
│   │   └── Workflows/ FeedService.php             (pure orchestrators)
│   ├── Adapters/
│   │   ├── PostgresFeedRepository.php             (driven adapter: raw SQL)
│   │   └── ... (Http/Controllers/ApiController.php = driving adapter, below)
│   ├── Http/Controllers/ApiController.php         (driving adapter: auth + DTOs)
│   └── Providers/AppServiceProvider.php           (composition root: binds port + infra DB config)
├── tests/Unit/FeedServiceTest.php                 (fake-repo unit tests; need dev deps)
├── composer.json                # slim production manifest (laravel/framework ^13.0)
└── .env.example
```

Dependencies point inward: `Domain` knows only `FeedRepository`; the Postgres
adapter implements it; the controller maps HTTP ⇄ domain. Swapping Postgres for
SQLite (the video's follow-up experiment) = one new adapter, zero domain changes.

## Run with docker compose

```bash
docker compose up -d --build        # every stack (incl. php) starts inline-built

# Traefik routes /php → php:9000 (prefix stripped; app sees /api/...)
curl -i -H "Authorization: Bearer 7" http://localhost/php/api/feed
```

## Tests

The repo ships `tests/Unit/FeedServiceTest.php` (fake FeedRepository, no DB).
Run it where dev dependencies are installed:

```bash
composer install                # installs dev deps incl. phpunit
vendor/bin/phpunit --filter=FeedServiceTest
```

## DATABASE_URL bootstrap (infra config)

The harness injects only `PORT` / `DATABASE_URL` / `POOL_SIZE`; Laravel's
`DB_HOST/DB_PORT/...` are absent, so `AppServiceProvider::boot()` parses
`DATABASE_URL` into the pgsql connection config (lazy connections). `POOL_SIZE`
is honored via the FrankenPHP Caddyfile in `docker-compose.yml`: `num_threads 10`
pins the thread pool, and each thread keeps one persistent PDO connection — the
container's Postgres pool is bounded at 10 (the contract's hard limit).

## Version fallback

`composer.json` targets Laravel 13 (`laravel/framework: ^13.0`, PHP ≥ 8.3). If
13.x is unavailable from the configured mirror at build time, the inline build
step in `docker-compose.yml` documents the one-line `laravel/laravel:^12.0`
fallback (app code is Laravel-major agnostic).

## Notes on contract fidelity

- `TrimStrings`/`ConvertEmptyStringsToNull` are removed from global middleware so
  `POST /api/posts` stores `content` verbatim, matching the other 7 stacks.
- `/api/*` routes use the framework `api` middleware group (SubstituteBindings
  only) — no CSRF/session/cookie overhead on POST.
- `postedAt` is formatted deterministically as UTC ISO-8601 ms (`.mmmZ`).