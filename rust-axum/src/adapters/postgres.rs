//! Driven adapter: PostgreSQL `FeedRepository`.
//!
//! Owns the raw SQL (verbatim from docs/../infra/api-contract.md) and maps rows → domain
//! models. Depends only on `sqlx` + the port contract. Raw `sqlx::Error` values
//! are wrapped into `FeedError::Database` at this boundary — they never cross
//! into the domain workflows.

use chrono::{DateTime, Utc};
use sqlx::postgres::PgPool;
use sqlx::Row;

use crate::domain::errors::FeedError;
use crate::domain::models::{Post, User};
use crate::domain::ports::FeedRepository;

/// Raw shared SQL (verbatim from docs/../infra/api-contract.md).
const POST_SELECT: &str = "\
SELECT p.id, p.user_id, u.username, u.display_name, p.content, p.posted_at, \
       (SELECT count(*) FROM likes l WHERE l.post_id = p.id) AS like_count \
FROM posts p \
JOIN users u ON u.id = p.user_id";

/// PostgreSQL-backed `FeedRepository` over a shared `PgPool`.
pub struct PostgresFeedRepository {
    pool: PgPool,
}

impl PostgresFeedRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// Translate a raw driver error into a domain error. FK violations (SQLSTATE
/// 23503 — e.g. a valid-format bearer token whose acting user doesn't exist)
/// become `FeedError::NotFound` so every stack answers 404 consistently;
/// anything else is a `FeedError::Database` (500).
fn db_err(e: sqlx::Error) -> FeedError {
    if let sqlx::Error::Database(db) = &e {
        if db.code().as_deref() == Some("23503") {
            return FeedError::not_found("not found");
        }
    }
    FeedError::database(e.to_string())
}

/// Map a query row into a domain `Post`.
fn row_to_post(row: &sqlx::postgres::PgRow) -> Result<Post, FeedError> {
    let post = Post {
        id: row.try_get("id").map_err(db_err)?,
        user_id: row.try_get("user_id").map_err(db_err)?,
        username: row.try_get("username").map_err(db_err)?,
        display_name: row.try_get("display_name").map_err(db_err)?,
        content: row.try_get("content").map_err(db_err)?,
        posted_at: row.try_get("posted_at").map_err(db_err)?,
        like_count: row.try_get("like_count").map_err(db_err)?,
    };
    Ok(post)
}

#[async_trait::async_trait]
impl FeedRepository for PostgresFeedRepository {
    /// SELECT id, username, display_name FROM users WHERE id = $1
    async fn find_user_by_id(&self, id: i64) -> Result<Option<User>, FeedError> {
        let row = sqlx::query("SELECT id, username, display_name FROM users WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;

        let user = match row {
            Some(r) => {
                let user = User {
                    id: r.try_get("id").map_err(db_err)?,
                    username: r.try_get("username").map_err(db_err)?,
                    display_name: r.try_get("display_name").map_err(db_err)?,
                };
                Some(user)
            }
            None => None,
        };
        Ok(user)
    }

    /// 20 newest posts (author + like count), ORDER BY posted_at DESC, id DESC.
    async fn feed(&self) -> Result<Vec<Post>, FeedError> {
        let sql = format!("{POST_SELECT} ORDER BY p.posted_at DESC, p.id DESC LIMIT 20");
        let rows = sqlx::query(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;

        let mut posts = Vec::with_capacity(rows.len());
        for row in &rows {
            posts.push(row_to_post(row)?);
        }
        Ok(posts)
    }

    /// Single post with author + like count.
    async fn find_post_by_id(&self, id: i64) -> Result<Option<Post>, FeedError> {
        let sql = format!("{POST_SELECT} WHERE p.id = $1");
        let row = sqlx::query(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;

        let post = match row {
            Some(r) => Some(row_to_post(&r)?),
            None => None,
        };
        Ok(post)
    }

    /// Idempotent like: INSERT INTO likes ... ON CONFLICT DO NOTHING.
    async fn like(&self, user_id: i64, post_id: i64) -> Result<(), FeedError> {
        sqlx::query(
            "INSERT INTO likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(user_id)
        .bind(post_id)
        .execute(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(())
    }

    /// INSERT INTO posts ... RETURNING id, posted_at (+ author snapshot).
    async fn create_post(&self, user_id: i64, content: String) -> Result<Post, FeedError> {
        let inserted = sqlx::query(
            "INSERT INTO posts (user_id, content) VALUES ($1, $2) RETURNING id, posted_at",
        )
        .bind(user_id)
        .bind(&content)
        .fetch_one(&self.pool)
        .await
        .map_err(db_err)?;

        let post_id: i64 = inserted.try_get("id").map_err(db_err)?;
        let posted_at: DateTime<Utc> = inserted.try_get("posted_at").map_err(db_err)?;

        // Author snapshot (single extra lookup, same as the reference backends).
        let author = sqlx::query("SELECT username, display_name FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&self.pool)
            .await
            .map_err(db_err)?;

        let username: String = author.try_get("username").map_err(db_err)?;
        let display_name: String = author.try_get("display_name").map_err(db_err)?;

        Ok(Post {
            id: post_id,
            user_id,
            username,
            display_name,
            content,
            posted_at,
            like_count: 0,
        })
    }
}