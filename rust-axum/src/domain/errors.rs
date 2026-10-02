//! Domain errors — the single error type crossing the domain boundary.
//!
//! Workflows produce `BadRequest` / `NotFound`. The driven adapter (Postgres)
//! wraps raw `sqlx::Error` into `Database` at the adapter boundary, so driver
//! errors never leak into workflows. The HTTP adapter maps each variant to a
//! status code (400 / 404 / 500).

use std::fmt;

/// Errors produced by the domain layer and the ports it depends on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FeedError {
    /// Invalid id / missing content → 400 in the HTTP adapter.
    BadRequest(String),
    /// Unknown user/post → 404 in the HTTP adapter.
    NotFound(String),
    /// Storage-layer failure (raw sqlx error wrapped by the Postgres adapter).
    Database(String),
}

impl FeedError {
    /// Stable machine-readable code, used by the workflow unit tests to assert
    /// error variants without depending on message text; part of the domain's
    /// error contract.
    #[allow(dead_code)] // live in unit tests only (the binary build doesn't call it)
    pub fn code(&self) -> &'static str {
        match self {
            FeedError::BadRequest(_) => "BAD_REQUEST",
            FeedError::NotFound(_) => "NOT_FOUND",
            FeedError::Database(_) => "DATABASE",
        }
    }

    pub fn bad_request(msg: impl Into<String>) -> Self {
        FeedError::BadRequest(msg.into())
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        FeedError::NotFound(msg.into())
    }

    pub fn database(msg: impl Into<String>) -> Self {
        FeedError::Database(msg.into())
    }
}

impl fmt::Display for FeedError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FeedError::BadRequest(m) => write!(f, "bad request: {m}"),
            FeedError::NotFound(m) => write!(f, "not found: {m}"),
            FeedError::Database(m) => write!(f, "database error: {m}"),
        }
    }
}

impl std::error::Error for FeedError {}