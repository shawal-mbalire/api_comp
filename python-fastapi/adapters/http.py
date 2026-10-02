"""Driving adapter: FastAPI HTTP surface. Translates wire formats → domain calls
via FeedService and maps domain results/errors → HTTP. No SQL and no business
rules here."""
from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import timezone

from fastapi import FastAPI, Header, HTTPException

from domain.errors import BadRequestError, NotFoundError
from domain.models import Post, User
from domain.workflows import FeedService


def _iso_utc(value) -> str:
    """ISO-8601 UTC with ms precision, e.g. "2026-07-01T12:00:00.000Z". Pure."""
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _post_dto(post: Post) -> dict:
    return {
        "id": post.id,
        "userId": post.user_id,
        "username": post.username,
        "displayName": post.display_name,
        "content": post.content,
        "postedAt": _iso_utc(post.posted_at),
        "likeCount": post.like_count,
    }


def _user_dto(user: User) -> dict:
    return {"id": user.id, "username": user.username, "displayName": user.display_name}


def _parse_acting_user(authorization: str | None) -> int:
    """Benchmark simplification: `Authorization: Bearer <user_id>` carries the
    numeric acting user id; missing/malformed → 401 at this boundary."""
    if not authorization:
        raise HTTPException(status_code=401, detail="unauthorized")
    scheme, _, token = authorization.partition(" ")
    try:
        user_id = int(token)
        if scheme.lower() != "bearer" or user_id <= 0:
            raise ValueError
    except ValueError:
        raise HTTPException(status_code=401, detail="unauthorized") from None
    return user_id


def create_app(make_service) -> FastAPI:
    """Build the FastAPI driving adapter. `make_service` is an async factory
    called once per worker process at startup returning (FeedService, close)
    where close releases the DB pool (lifecycle hook at shutdown)."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        service, close = await make_service()
        app.state.service = service
        yield
        await close()

    app = FastAPI(title="Benchmark Feed API (FastAPI)", lifespan=lifespan)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/api/me")
    async def me(authorization: str | None = Header(default=None)):
        try:
            return _user_dto(await app.state.service.get_me(_parse_acting_user(authorization)))
        except (BadRequestError, NotFoundError) as e:
            raise _http_error(e) from None

    @app.get("/api/feed")
    async def feed(authorization: str | None = Header(default=None)):
        acting = _parse_acting_user(authorization)
        posts = await app.state.service.get_feed(acting)
        return [_post_dto(p) for p in posts]

    @app.get("/api/posts/{post_id}")
    async def get_post(post_id: str, authorization: str | None = Header(default=None)):
        acting = _parse_acting_user(authorization)
        try:
            return _post_dto(await app.state.service.get_post(acting, post_id))
        except (BadRequestError, NotFoundError) as e:
            raise _http_error(e) from None

    @app.post("/api/posts/{post_id}/like", status_code=204)
    async def like_post(post_id: str, authorization: str | None = Header(default=None)):
        acting = _parse_acting_user(authorization)
        try:
            await app.state.service.like_post(acting, post_id)
        except (BadRequestError, NotFoundError) as e:
            raise _http_error(e) from None
        return None  # 204 No Content

    @app.post("/api/posts", status_code=201)
    async def create_post(body: dict, authorization: str | None = Header(default=None)):
        acting = _parse_acting_user(authorization)
        try:
            return _post_dto(await app.state.service.create_post(acting, body.get("content")))
        except (BadRequestError, NotFoundError) as e:
            raise _http_error(e) from None

    return app


def _http_error(e: Exception) -> HTTPException:
    if isinstance(e, BadRequestError):
        return HTTPException(status_code=400, detail="bad request")
    if isinstance(e, NotFoundError):
        return HTTPException(status_code=404, detail="not found")
    return HTTPException(status_code=500, detail="internal error")