"""Composition root: reads config → builds the asyncpg pool (per worker) → wires
the PostgresFeedRepository into the FeedService → exposes the FastAPI driving
adapter. Uvicorn runs 3 workers (see Dockerfile), so this wiring runs once per
process, each with its own pool of exactly POOL_SIZE connections."""
from __future__ import annotations

from adapters.http import create_app
from adapters.postgres import PostgresFeedRepository, create_pool
from domain.workflows import FeedService
from infra.config import load_settings


async def _make_service():
    """Factory used by the adapter's lifespan: returns (service, close-hook)."""
    settings = load_settings()
    pool = await create_pool(settings.connection_uri, settings.pool_size)
    repo = PostgresFeedRepository(pool)
    service = FeedService(repo)
    return service, pool.close


app = create_app(_make_service)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=load_settings().port, workers=3)