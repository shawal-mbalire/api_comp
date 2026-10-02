"""Driving adapter: FastAPI HTTP surface. Translates wire formats → domain calls
via FeedService and maps domain results/errors → HTTP. No SQL and no business
rules here."""
from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import timezone
from typing import Any

from fastapi import FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from domain.errors import BadRequestError, NotFoundError
from domain.models import Post, User
from domain.workflows import FeedService


class ApiError(Exception):
    """Wire error that carries the contract's ``{"error": <message>}`` JSON body.

    Raised by this adapter for 400/404/401; rendered by the registered FastAPI
    exception handler so error bodies match the OpenAPI ``Error`` schema
    (``{"error": ...}``) instead of FastAPI's default ``{"detail": ...}``.
    """

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


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
    numeric acting user id; missing/malformed → 401 at this boundary.

    The token must be a bare positive integer (digits only) — `int()` would
    otherwise accept trailing whitespace, floats, or hex, diverging from the
    strict parsers in the other stacks."""
    if not authorization:
        raise ApiError(401, "unauthorized")
    scheme, sep, token = authorization.partition(" ")
    if not sep or scheme.lower() != "bearer" or not token.isdigit():
        raise ApiError(401, "unauthorized")
    user_id = int(token)
    if user_id <= 0:
        raise ApiError(401, "unauthorized")
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

    app = FastAPI(
        title="Benchmark Feed API (FastAPI)",
        lifespan=lifespan,
        # Error bodies must match the contract's {"error": ...} schema on every
        # status; the default {"detail": ...} would violate it.
        exception_handlers={
            ApiError: _api_error_handler,
            RequestValidationError: _validation_error_handler,
            Exception: _internal_error_handler,
        },
        # Exact contract surface only — no framework docs routes.
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

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
    async def create_post(body: Any = None, authorization: str | None = Header(default=None)):
        acting = _parse_acting_user(authorization)
        content = body.get("content") if isinstance(body, dict) else None
        try:
            return _post_dto(await app.state.service.create_post(acting, content))
        except (BadRequestError, NotFoundError) as e:
            raise _http_error(e) from None

    return app


def _http_error(e: Exception) -> ApiError:
    if isinstance(e, BadRequestError):
        return ApiError(400, "bad request")
    if isinstance(e, NotFoundError):
        return ApiError(404, "not found")
    return ApiError(500, "internal error")


async def _api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": exc.message})


async def _validation_error_handler(_: Request, __: RequestValidationError) -> JSONResponse:
    """Malformed/missing bodies surface as 400 (contract), never FastAPI's 422."""
    return JSONResponse(status_code=400, content={"error": "bad request"})


async def _internal_error_handler(_: Request, __: Exception) -> JSONResponse:
    return JSONResponse(status_code=500, content={"error": "internal error"})