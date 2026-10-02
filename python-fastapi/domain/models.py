from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True)
class User:
    """An author / acting user (the bearer token carries the numeric id)."""
    id: int
    username: str
    display_name: str


@dataclass(frozen=True)
class Post:
    """A feed item with an author snapshot and a like count."""
    id: int
    user_id: int
    username: str
    display_name: str
    content: str
    posted_at: datetime  # UTC, straight from TIMESTAMPTZ rows
    like_count: int = field(default=0)