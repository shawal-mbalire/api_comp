# Feed API — Go (stdlib `net/http` + pgx) — hexagonal

Single-process benchmark backend implementing `../infra/api-contract.md`.

## Hexagonal layout

```
go-stdlib/
├── main.go                 # composition root (wires adapters → workflows → HTTP)
├── domain/                 # pure application logic — no net/http or DB imports
│   ├── models.go           # User, Post
│   ├── errors.go           # BadRequestError, NotFoundError
│   ├── ports.go            # FeedRepository port
│   └── workflows.go        # FeedService — pure orchestrators (validate → drive repo)
├── adapters/
│   ├── postgres.go         # driven adapter: FeedRepository (pgx, raw SQL)
│   └── http.go             # driving adapter: net/http handlers, auth + DTO mapping
├── infra/
│   └── config.go           # typed config from env (only place env vars are read)
├── tests/
│   └── workflows_test.go   # unit tests with a fake in-memory repository
├── (image built inline in docker-compose.yml)
└── go.mod
```

## Run

```bash
go test ./...                          # unit tests (fake repo)
PORT=8081 DATABASE_URL=postgres://app:app@localhost:5432/app go run .
```

## Docker

```bash
docker compose up -d --build
# Traefik routes /go → go:8081 (prefix stripped)
curl -i -H "Authorization: Bearer 7" http://localhost/go/api/feed
```