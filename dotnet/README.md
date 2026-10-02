# Feed API — .NET 10 (ASP.NET Core Minimal API + Npgsql, hexagonal)

Single-process benchmark backend implementing `../infra/api-contract.md`: raw Npgsql
SQL (no ORM, no external cache), connection pool forced to `POOL_SIZE` (10 per
process). The code is organized as **Hexagonal Architecture (Ports & Adapters)**
mirroring the `node-express` template.

## Hexagonal layout

```
dotnet/
├── Program.cs                  # composition root (wires config → adapters → workflow → HTTP → run)
├── Domain/                     # pure application logic — zero framework imports
│   ├── Models.cs               # record User, record Post (pure data)
│   ├── Errors.cs               # BadRequestException, NotFoundException (with Code)
│   ├── Ports.cs                # IFeedRepository port (the data-access boundary)
│   └── Workflows.cs            # FeedService — pure orchestrators (validate → drive the port)
├── Adapters/
│   ├── PostgresFeedRepository.cs # driven adapter: IFeedRepository (raw contract SQL via Npgsql)
│   └── Http.cs                 # driving adapter: MapApiEndpoints (routes, auth, DTO mapping)
├── Infra/
│   └── Config.cs               # frozen Config record from env (ONLY place env vars are read)
├── Tests/
│   ├── Apicomp.Tests.csproj    # xunit test project (references apicomp.csproj)
│   └── FeedServiceTests.cs     # FeedService unit tests with a fake in-memory repository
├── apicomp.csproj
├── (image built inline in docker-compose.yml)
└── README.md
```

Dependencies point inward: `Domain/` knows only its own models and the
`IFeedRepository` port; `Adapters/` implement the port (only they touch Npgsql /
ASP.NET types); `Program.cs` is the composition root and contains no business
logic.

## Run

Requires the .NET 10 SDK:

```bash
cd dotnet
PORT=5000 DATABASE_URL=postgres://app:app@localhost:5432/app POOL_SIZE=10 dotnet run
```

(`DATABASE_URL` uses `db` as the host inside docker compose, `localhost` for a
local run against a Dockerized Postgres. The server binds `http://0.0.0.0:5000` —
port from `PORT`, default 5000.)

## Test

Unit tests exercise `FeedService` through a fake in-memory `IFeedRepository`
(no database needed):

```bash
dotnet test Tests/Apicomp.Tests.csproj
```

Build everything (app + tests):

```bash
dotnet build -c Release                  # the web app
dotnet build -c Release Tests/Apicomp.Tests.csproj   # app + tests
```

## Docker

```bash
docker compose up -d --build
```

The inline build (`dockerfile_inline` in docker-compose.yml) publishes
`apicomp.csproj` to `/app/publish` and runs on
`ASPNETCORE_URLS=http://+:5000` (the `Tests/` project is excluded from the web
app build so it never enters the image).

```bash
curl -i -H "Authorization: Bearer 7" http://localhost:5000/api/feed
```

## Contract notes

- `Authorization: Bearer <user_id>` — the bearer token is the acting user id
  (benchmark simplification). Missing/malformed → `401`.
- `GET /health` is the only unauthenticated endpoint (`200 {"status":"ok"}`).
- `like` → `204`, `create` → `201`; domain errors map to `400`/`404`.
- `postedAt` is rendered ISO-8601 UTC (round-trip `"O"`,
  e.g. `2026-07-01T12:00:00.0000000Z`).
- Pool size is forced to `POOL_SIZE` (default 10) on the single
  `NpgsqlDataSource` instance.