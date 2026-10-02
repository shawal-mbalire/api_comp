"""Driven adapter: PostgreSQL FeedRepository (asyncpg). Owns the raw SQL
(verbatim from ../infra/api-contract.md) and maps rows → domain models. Zero imports
from the rest of the app beyond the domain models/port."""
from __future__ import annotations

import asyncpg
from asyncpg.exceptions import ForeignKeyViolationError

from domain.errors import NotFoundError
from domain.models import Post, User

POST_SELECT = """
    SELECT p.id, p.user_id, u.username, u.display_name, p.content, p.posted_at,
           (SELECT count(*) FROM likes l WHERE l.post_id = p.id) AS like_count
    FROM posts p
    JOIN users u ON u.id = p.user_id
"""


def row_to_post(row: asyncpg.Record) -> Post:
    return Post(
        id=row["id"],
        user_id=row["user_id"],
        username=row["username"],
        display_name=row["display_name"],
        content=row["content"],
        posted_at=row["posted_at"],
        like_count=row["like_count"],
    )


class PostgresFeedRepository:
    """Implements domain.ports.FeedRepository. Pool lifecycle is owned by the
    composition root (one pool per Uvicorn worker, max_size == POOL_SIZE)."""

    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def find_by_user_id(self, user_id: int) -> User | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id, username, display_name FROM users WHERE id = $1", user_id)
        if row is None:
            return None
        return User(id=row["id"], username=row["username"], display_name=row["display_name"])

    async def feed(self) -> list[Post]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                POST_SELECT + "ORDER BY p.posted_at DESC, p.id DESC LIMIT 20")
        return [row_to_post(r) for r in rows]

    async def find_post_by_id(self, post_id: int) -> Post | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(POST_SELECT + "WHERE p.id = $1", post_id)
        return None if row is None else row_to_post(row)

    async def like(self, user_id: int, post_id: int) -> None:
        try:
            async with self._pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                    user_id, post_id)
        except ForeignKeyViolationError:
            # Acting user doesn't exist (post existence is pre-checked) → 404 parity.
            raise NotFoundError() from None

    async def create_post(self, user_id: int, content: str) -> Post:
        try:
            async with self._pool.acquire() as conn:
                row = await conn.fetchrow(
                    "INSERT INTO posts (user_id, content) VALUES ($1, $2) RETURNING id, user_id, posted_at",
                    user_id, content)
                author = await conn.fetchrow(
                    "SELECT id, username, display_name FROM users WHERE id = $1", user_id)
        except ForeignKeyViolationError:
            # Acting user doesn't exist → 404 parity.
            raise NotFoundError() from None
        return Post(
            id=row["id"],
            user_id=row["user_id"],
            username=author["username"],
            display_name=author["display_name"],
            content=content,
            posted_at=row["posted_at"],
            like_count=0,
        )


async def create_pool(connection_uri: str, pool_size: int) -> asyncpg.Pool:
    """Adapts the config (frozen settings) into an asyncpg pool. One pool per
    Uvicorn worker process; max_size is the experiment's hard limit."""
    return await asyncpg.create_pool(dsn=connection_uri, min_size=1, max_size=pool_size)