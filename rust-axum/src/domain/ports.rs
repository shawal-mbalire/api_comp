//! Ports — contracts the domain needs fulfilled by driven adapters.
//!
//! Implementations:
//! - `adapters::postgres::PostgresFeedRepository` (production, benchmark)
//! - an in-memory fake in the workflow unit tests
//!
//! SQL semantics come verbatim from docs/../infra/api-contract.md. The trait is async,
//! dyn-compatible and `Send + Sync` so it can live inside Axum state behind
//! `Box<dyn FeedRepository>` / `Arc<FeedService>`.

use crate::domain::errors::FeedError;
use crate::domain::models::{Post, User};

/// FeedRepository port — the data-access boundary.
#[async_trait::async_trait]
pub trait FeedRepository: Send + Sync {
    /// `SELECT id, username, display_name FROM users WHERE id = $1`
    async fn find_user_by_id(&self, id: i64) -> Result<Option<User>, FeedError>;

    /// The 20 newest posts with author + like count:
    /// `ORDER BY p.posted_at DESC, p.id DESC LIMIT 20`
    async fn feed(&self) -> Result<Vec<Post>, FeedError>;

    /// Single post with author + like count; `None` when the id is unknown.
    async fn find_post_by_id(&self, id: i64) -> Result<Option<Post>, FeedError>;

    /// Idempotent like: `INSERT INTO likes ... ON CONFLICT DO NOTHING`.
    async fn like(&self, user_id: i64, post_id: i64) -> Result<(), FeedError>;

    /// `INSERT INTO posts ... RETURNING id, posted_at` (+ author snapshot).
    async fn create_post(&self, user_id: i64, content: String) -> Result<Post, FeedError>;
}