//! Driving adapter: Axum HTTP surface.
//!
//! Translates wire formats (authorization header, JSON bodies, path params)
//! into domain calls via `FeedService`, and maps domain results/errors → HTTP
//! DTOs. No SQL here, no business rules (rules live in domain/workflows.rs).

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{FromRequestParts, Path, State};
use axum::http::request::Parts;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};

use crate::domain::errors::FeedError;
use crate::domain::models::{Post, User};
use crate::domain::workflows::FeedService;

/// Shared Axum state: the domain service (workflows over the repo port).
#[derive(Clone)]
pub struct AppState {
    pub service: Arc<FeedService>,
}

impl AppState {
    pub fn new(service: Arc<FeedService>) -> Self {
        Self { service }
    }
}

// ── HTTP DTOs (exact camelCase JSON from docs/../infra/api-contract.md) ─────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UserDto {
    id: i64,
    username: String,
    display_name: String,
}

impl From<User> for UserDto {
    fn from(u: User) -> Self {
        Self {
            id: u.id,
            username: u.username,
            display_name: u.display_name,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostDto {
    id: i64,
    user_id: i64,
    username: String,
    display_name: String,
    content: String,
    posted_at: String,
    like_count: i64,
}

impl From<Post> for PostDto {
    fn from(p: Post) -> Self {
        Self {
            id: p.id,
            user_id: p.user_id,
            username: p.username,
            display_name: p.display_name,
            content: p.content,
            posted_at: format_iso8601(p.posted_at),
            like_count: p.like_count,
        }
    }
}

/// ISO-8601 UTC with milliseconds, e.g. "2026-07-01T12:00:00.000Z".
fn format_iso8601(dt: DateTime<Utc>) -> String {
    dt.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

// ── error responses ────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

fn error_response(status: StatusCode, msg: &str) -> Response {
    (status, Json(ErrorBody { error: msg.to_string() })).into_response()
}

fn unauthorized() -> Response {
    error_response(StatusCode::UNAUTHORIZED, "unauthorized")
}

/// Map a domain error to an HTTP response. The `FeedError` message is carried
/// through so each 400/404 keeps its exact historical body (e.g. the `404`
/// `"not found"` and the missing-content `400` `"content required"`).
fn map_domain_error(err: FeedError) -> Response {
    match err {
        FeedError::BadRequest(msg) => error_response(StatusCode::BAD_REQUEST, &msg),
        FeedError::NotFound(msg) => error_response(StatusCode::NOT_FOUND, &msg),
        FeedError::Database(_) => {
            error_response(StatusCode::INTERNAL_SERVER_ERROR, "internal error")
        }
    }
}

// ── auth extractor ─────────────────────────────────────────────────────────────

/// Benchmark simplification: `Authorization: Bearer <user_id>` — the bearer
/// token IS the acting user's numeric id. Missing/malformed ⇒ 401 at this
/// boundary (the contract's authentication rule).
struct ActingUser(i64);

impl FromRequestParts<AppState> for ActingUser {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        _state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let value = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(unauthorized)?;
        let token = value.strip_prefix("Bearer ").ok_or_else(unauthorized)?;
        let id: i64 = token.trim().parse().map_err(|_| unauthorized())?;
        if id <= 0 {
            return Err(unauthorized());
        }
        Ok(ActingUser(id))
    }
}

// ── handlers ────────────────────────────────────────────────────────────────────

async fn health() -> Response {
    Json(json!({ "status": "ok" })).into_response()
}

async fn me(State(state): State<AppState>, ActingUser(user_id): ActingUser) -> Response {
    match state.service.get_me(user_id).await {
        Ok(user) => Json(UserDto::from(user)).into_response(),
        Err(err) => map_domain_error(err),
    }
}

async fn feed(State(state): State<AppState>, _user: ActingUser) -> Response {
    match state.service.get_feed().await {
        Ok(posts) => {
            let dtos: Vec<PostDto> = posts.into_iter().map(PostDto::from).collect();
            Json(dtos).into_response()
        }
        Err(err) => map_domain_error(err),
    }
}

async fn get_post(
    State(state): State<AppState>,
    _user: ActingUser,
    Path(id): Path<String>,
) -> Response {
    match state.service.get_post(&id).await {
        Ok(post) => Json(PostDto::from(post)).into_response(),
        Err(err) => map_domain_error(err),
    }
}

async fn like_post(
    State(state): State<AppState>,
    ActingUser(user_id): ActingUser,
    Path(id): Path<String>,
) -> Response {
    match state.service.like_post(user_id, &id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => map_domain_error(err),
    }
}

async fn create_post(
    State(state): State<AppState>,
    ActingUser(user_id): ActingUser,
    body: Bytes,
) -> Response {
    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            return map_domain_error(FeedError::BadRequest("bad request".to_string()));
        }
    };
    let content: &str = match parsed.get("content") {
        Some(Value::String(s)) => s,
        _ => "",
    };
    match state.service.create_post(user_id, content).await {
        Ok(post) => (StatusCode::CREATED, Json(PostDto::from(post))).into_response(),
        Err(err) => map_domain_error(err),
    }
}

// ── router (driving adapter wiring) ─────────────────────────────────────────────

/// Build the Axum router over the domain service.
pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/me", get(me))
        .route("/api/feed", get(feed))
        .route("/api/posts/{id}", get(get_post))
        .route("/api/posts/{id}/like", post(like_post))
        .route("/api/posts", post(create_post))
        .with_state(state)
}