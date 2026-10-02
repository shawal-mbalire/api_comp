//! Domain models — pure data, zero imports beyond chrono. Field names are
//! snake_case internally; the HTTP adapter (adapters/http.rs) owns the exact
//! camelCase JSON DTO mapping required by docs/../infra/api-contract.md.

use chrono::{DateTime, Utc};

/// A user (author). `id` is the acting-user id carried by `Bearer <id>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub display_name: String,
}

/// A post with its author snapshot and like count.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Post {
    pub id: i64,
    pub user_id: i64,
    pub username: String,
    pub display_name: String,
    pub content: String,
    pub posted_at: DateTime<Utc>,
    pub like_count: i64,
}