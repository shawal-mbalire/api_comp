# Feed API — Go with Gin (gin-gonic) + pgx — hexagonal

Single-process benchmark backend implementing `../infra/api-contract.md`, using
**Gin** (gin-gonic) as the HTTP driving adapter — no other web framework.

## Hexagonal layout

```
go-gin/
├── main.go                 # composition root (wires adapters → workflows → Gin)
├── domain/                 # pure application logic — no net/http or DB imports
│   ├── models.go           # User, Post
│   ├── errors.go           # BadRequestError, NotFoundError
│   ├── ports.go            # FeedRepository port
│   └── workflows.go        # FeedService — pure orchestrators (validate → drive repo)
├── adapters/
│   ├── postgres.go         # driven adapter: FeedRepository (pgx, raw SQL)
│   └── http.go             # driving adapter: Gin routes, auth + DTO mapping
├── infra/
│   └── config.go           # typed config from env (only place env vars are read)
├── tests/
│   ├── workflows_test.go   # unit tests with a fake in-memory repository
│   └── http_test.go        # Gin route tests via httptest (no socket/DB)
├── (image built inline in docker-compose.yml)
└── go.mod
```

Dependencies point inward: `domain` knows only the `FeedRepository` port; the
Postgres adapter implements it; the Gin adapter maps HTTP ⇄ domain.

## Run

```bash
go test ./...                          # domain + Gin route tests (fake repo)
PORT=8081 DATABASE_URL=postgres://app:app@localhost:5432/app go run .
```

## Docker

```bash
docker compose up -d --build
# Traefik routes /go → go:8081 (prefix stripped)
curl -i -H "Authorization: Bearer 7" http://localhost/go/api/feed
```