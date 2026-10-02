from __future__ import annotations

from typing import Protocol

from .models import Post, User


class FeedRepository(Protocol):
    """Data-access port the domain needs fulfilled.

    Implementations: adapters/postgres.py (benchmark Postgres). A second
    implementation (SQLite — the video's follow-up experiment) can be added
    without touching the workflows.
    """

    async def find_by_user_id(self, user_id: int) -> User | None: ...

    async def feed(self) -> list[Post]: ...  # 20 newest, author + like count

    async def find_post_by_id(self, post_id: int) -> Post | None: ...

    async def like(self, user_id: int, post_id: int) -> None: ...  # idempotent

    async def create_post(self, user_id: int, content: str) -> Post: ...