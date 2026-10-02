# Feed API — Python (FastAPI + Uvicorn, 3 workers) — hexagonal

Benchmark backend implementing `../infra/api-contract.md`.

## Hexagonal layout

```
python-fastapi/
├── main.py                 # composition root (per-worker wiring; uvicorn main:app)
├── domain/                 # pure application logic — no FastAPI/asyncpg imports
│   ├── models.py           # User, Post (frozen dataclasses)
│   ├── errors.py           # BadRequestError, NotFoundError
│   ├── ports.py            # FeedRepository Protocol
│   └── workflows.py        # FeedService — pure orchestrators (validate → drive repo)
├── adapters/
│   ├── postgres.py         # driven adapter: asyncpg FeedRepository (raw SQL)
│   └── http.py             # driving adapter: FastAPI routes, auth + DTO mapping
├── infra/
│   └── config.py           # Settings from env (only place env vars are read)
├── tests/
│   └── test_workflows.py   # unit tests with a fake repository
├── requirements.txt
└── (image built inline in docker-compose.yml)
```

## Run

```bash
python3 -m unittest tests.test_workflows          # unit tests (fake repo)
pip install -r requirements.txt
PORT=8000 DATABASE_URL=postgres://app:app@localhost:5432/app uvicorn main:app --workers 3
```

## Docker

```bash
docker compose up -d --build
# Traefik routes /fastapi → fastapi:8000 (prefix stripped)
curl -i -H "Authorization: Bearer 7" http://localhost/fastapi/api/feed
```

Each of the 3 Uvicorn workers builds its own asyncpg pool of exactly `POOL_SIZE` (10)
connections — the experiment's per-process limit.