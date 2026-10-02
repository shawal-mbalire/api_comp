from __future__ import annotations

from .errors import BadRequestError, NotFoundError
from .models import Post, User
from .ports import FeedRepository


def parse_id(raw: str) -> int:
    """Validate a positive integer id. Pure."""
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise BadRequestError() from None
    if value <= 0:
        raise BadRequestError()
    return value


def validate_content(raw: object) -> str:
    """Validate post content. Pure. Returns trimmed content or raises."""
    content = raw.strip() if isinstance(raw, str) else ""
    if not content:
        raise BadRequestError("content required")
    return content


async def get_me(repo: FeedRepository, acting_user: int) -> User:
    user = await repo.find_by_user_id(acting_user)
    if user is None:
        raise NotFoundError()
    return user


async def get_feed(repo: FeedRepository, _acting_user: int) -> list[Post]:
    return await repo.feed()


async def get_post(repo: FeedRepository, _acting_user: int, raw_id: str) -> Post:
    post = await repo.find_post_by_id(parse_id(raw_id))
    if post is None:
        raise NotFoundError()
    return post


async def like_post(repo: FeedRepository, acting_user: int, raw_id: str) -> None:
    post = await repo.find_post_by_id(parse_id(raw_id))
    if post is None:
        raise NotFoundError()
    await repo.like(acting_user, post.id)


async def create_post(repo: FeedRepository, acting_user: int, raw_content: object) -> Post:
    return await repo.create_post(acting_user, validate_content(raw_content))


class FeedService:
    """Pure orchestrators over the FeedRepository port. No I/O, no framework."""

    def __init__(self, repo: FeedRepository):
        self._repo = repo

    def get_me(self, user_id: int):
        return get_me(self._repo, user_id)

    def get_feed(self, acting_user: int):
        return get_feed(self._repo, acting_user)

    def get_post(self, acting_user: int, raw_id: str):
        return get_post(self._repo, acting_user, raw_id)

    def like_post(self, acting_user: int, raw_id: str):
        return like_post(self._repo, acting_user, raw_id)

    def create_post(self, acting_user: int, raw_content: object):
        return create_post(self._repo, acting_user, raw_content)