# Feed API — Spring Boot 3 on Java 21 (hexagonal)

MVC + Tomcat benchmark backend implementing `../infra/api-contract.md`: `JdbcTemplate`
over raw SQL + HikariCP, no ORM (no JPA), no external cache. Refactored into
Hexagonal Architecture (Ports & Adapters) following the repo's canonical
`node-express` template.

## Hexagonal layout

```
java-spring/
├── (image built inline in docker-compose.yml)                  # multi-stage: maven build → eclipse-temurin:25-jre
├── pom.xml                     # Spring Boot 3.3, JUnit 5 test scope
├── src/main/java/dev/bench/
│   ├── BackendApplication.java # composition root: @SpringBootApplication + FeedService bean
│   ├── domain/                 # pure application core — zero framework/JDBC imports
│   │   ├── models/             #   User, Post (plain records)
│   │   ├── errors/             #   BadRequestError, NotFoundError (with code)
│   │   ├── ports/              #   FeedRepository (the data-access boundary)
│   │   └── workflows/          #   FeedService — pure orchestrators (validate → drive repo)
│   ├── adapters/
│   │   ├── http/               # driving adapter: FeedController (auth, DTO mapping),
│   │   │                       #   FeedExceptionHandler (domain errors → HTTP), DTOs
│   │   └── postgres/           # driven adapter: PostgresFeedRepository (raw contract SQL)
│   └── infra/
│       └── config/             # DataSourceConfig — env → Hikari pool (POOL_SIZE max),
│                               #   DATABASE_URL parsed to jdbc:postgresql://
├── src/main/resources/
│   └── application.properties  # PORT binding (${PORT:8080})
└── src/test/java/
    └── dev/bench/domain/workflows/
        └── FeedServiceTest.java  # unit tests with a fake in-memory FeedRepository
```

Dependencies point inward: `domain` knows only its ports; `adapters` implement the
ports; `infra` assembles config. Swapping PostgreSQL for another store means adding
one driven adapter — the domain never changes.

## Run

```bash
mvn -q -DskipTests package                      # build the fat jar
PORT=8080 DATABASE_URL=postgres://app:app@localhost:5432/app POOL_SIZE=10 java -jar target/app.jar
```

* Port: `8080` (`PORT`, default 8080)
* Pool size: exactly `POOL_SIZE` (experiment hard limit, default 10)
* DB: `DATABASE_URL` in `postgres://user:pass@host:port/db` form (converted to a
  `jdbc:postgresql://` URL internally)

## Test

```bash
mvn test        # JUnit 5 unit tests for the FeedService workflow (fake repo, no DB)
```

Covers: parseId/validateContent pure helpers; getMe unknown → NotFound; getPost bad
id → BadRequest / unknown → NotFound; like unknown → NotFound; create blank → BadRequest.

## Docker

```bash
docker compose up -d --build
```

Traefik routes `/java` → java:8080 and strips the prefix; the container exposes
8080 directly on the compose network.

## Contract

See `../infra/api-contract.md` — endpoints, status codes, JSON shapes and SQL are
identical across all stacks.