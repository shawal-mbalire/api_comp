"""Infra: config plumbing — the only place environment variables are read."""
from __future__ import annotations

import os
from dataclasses import dataclass, field

DEFAULT_PORT = 8000
DEFAULT_DATABASE_URL = "postgres://app:app@db:5432/app"
DEFAULT_POOL_SIZE = 10


def _positive_int(raw: str | None, default: int) -> int:
    try:
        value = int(raw) if raw is not None else default
    except ValueError:
        return default
    return value if value > 0 else default


@dataclass(frozen=True)
class Settings:
    port: int = DEFAULT_PORT
    connection_uri: str = DEFAULT_DATABASE_URL
    pool_size: int = DEFAULT_POOL_SIZE


def load_settings(env: dict | None = None) -> Settings:
    env = env if env is not None else os.environ
    return Settings(
        port=_positive_int(env.get("PORT"), DEFAULT_PORT),
        connection_uri=env.get("DATABASE_URL", DEFAULT_DATABASE_URL),
        pool_size=_positive_int(env.get("POOL_SIZE"), DEFAULT_POOL_SIZE),
    )