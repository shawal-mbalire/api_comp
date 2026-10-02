//! Domain workflows — pure orchestrators. Each function validates its inputs
//! first, then drives the `FeedRepository` port. No I/O and no framework
//! imports here; the only errors produced are BadRequest / NotFound (Database
//! errors propagate untouched from the port so adapters own driver mapping).

use crate::domain::errors::FeedError;
use crate::domain::models::{Post, User};
use crate::domain::ports::FeedRepository;

/// Parse a raw path id into a positive integer. Pure.
pub fn parse_id(raw: &str) -> Result<i64, FeedError> {
    let id = match raw.parse::<i64>() {
        Ok(v) if v > 0 => v,
        _ => return Err(FeedError::bad_request("bad request")),
    };
    Ok(id)
}

/// Validate post content: trim, reject empty. Pure.
pub fn validate_content(raw: &str) -> Result<String, FeedError> {
    let content = raw.trim().to_string();
    if content.is_empty() {
        // Every stack renders all 400s as {"error":"bad request"}.
        return Err(FeedError::bad_request("bad request"));
    }
    Ok(content)
}

/// FeedService — a façade over the `FeedRepository` port.
///
/// The composition root injects the concrete repository (Postgres in
/// production, fakes in tests). The HTTP adapter calls these methods.
pub struct FeedService {
    repo: Box<dyn FeedRepository>,
}

impl FeedService {
    pub fn new(repo: Box<dyn FeedRepository>) -> Self {
        Self { repo }
    }

    /// GET /api/me → the acting user, or NotFound when unknown.
    pub async fn get_me(&self, user_id: i64) -> Result<User, FeedError> {
        let found = self.repo.find_user_by_id(user_id).await?;
        match found {
            Some(user) => Ok(user),
            None => Err(FeedError::not_found("not found")),
        }
    }

    /// GET /api/feed → the 20 newest posts (acting user not needed).
    pub async fn get_feed(&self) -> Result<Vec<Post>, FeedError> {
        self.repo.feed().await
    }

    /// GET /api/posts/{id} → the post, 404 when unknown.
    pub async fn get_post(&self, raw_id: &str) -> Result<Post, FeedError> {
        let id = parse_id(raw_id)?;
        let found = self.repo.find_post_by_id(id).await?;
        match found {
            Some(post) => Ok(post),
            None => Err(FeedError::not_found("not found")),
        }
    }

    /// POST /api/posts/{id}/like → idempotent, 404 when the post is unknown.
    pub async fn like_post(&self, user_id: i64, raw_id: &str) -> Result<(), FeedError> {
        let id = parse_id(raw_id)?;
        let found = self.repo.find_post_by_id(id).await?;
        match found {
            Some(_) => {}
            None => return Err(FeedError::not_found("not found")),
        }
        self.repo.like(user_id, id).await
    }

    /// POST /api/posts → 201 with the created post.
    pub async fn create_post(&self, user_id: i64, raw_content: &str) -> Result<Post, FeedError> {
        let content = validate_content(raw_content)?;
        self.repo.create_post(user_id, content).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::models::{Post, User};
    use chrono::{TimeZone, Utc};

    const ALICE_ID: i64 = 1;
    const KNOWN_POST_ID: i64 = 10;

    fn alice() -> User {
        User {
            id: ALICE_ID,
            username: "user_000001".to_string(),
            display_name: "Alice".to_string(),
        }
    }

    fn a_post() -> Post {
        Post {
            id: KNOWN_POST_ID,
            user_id: ALICE_ID,
            username: "user_000001".to_string(),
            display_name: "Alice".to_string(),
            content: "hello hexagon".to_string(),
            posted_at: Utc.with_ymd_and_hms(2026, 7, 1, 12, 0, 0).unwrap(),
            like_count: 2,
        }
    }

    /// In-memory fake implementation of the `FeedRepository` port.
    struct FakeRepo {
        user: Option<User>,
        post: Option<Post>,
    }

    impl FakeRepo {
        fn new() -> Self {
            Self {
                user: Some(alice()),
                post: Some(a_post()),
            }
        }
    }

    #[async_trait::async_trait]
    impl FeedRepository for FakeRepo {
        async fn find_user_by_id(&self, id: i64) -> Result<Option<User>, FeedError> {
            let user = match self.user.as_ref() {
                Some(u) if u.id == id => Some(u.clone()),
                _ => None,
            };
            Ok(user)
        }

        async fn feed(&self) -> Result<Vec<Post>, FeedError> {
            let posts = match self.post.as_ref() {
                Some(p) => vec![p.clone()],
                None => Vec::new(),
            };
            Ok(posts)
        }

        async fn find_post_by_id(&self, id: i64) -> Result<Option<Post>, FeedError> {
            let post = match self.post.as_ref() {
                Some(p) if p.id == id => Some(p.clone()),
                _ => None,
            };
            Ok(post)
        }

        async fn like(&self, _user_id: i64, _post_id: i64) -> Result<(), FeedError> {
            Ok(())
        }

        async fn create_post(&self, user_id: i64, content: String) -> Result<Post, FeedError> {
            Ok(Post {
                id: 99,
                user_id,
                username: "user_000001".to_string(),
                display_name: "Alice".to_string(),
                content,
                posted_at: Utc.with_ymd_and_hms(2026, 7, 1, 13, 0, 0).unwrap(),
                like_count: 0,
            })
        }
    }

    fn service() -> FeedService {
        FeedService::new(Box::new(FakeRepo::new()))
    }

    // ── pure helpers ──────────────────────────────────────────────────────────────

    #[test]
    fn parse_id_accepts_positive_integers_only() {
        assert_eq!(parse_id("7").unwrap(), 7);
        assert_eq!(parse_id("abc").unwrap_err().code(), "BAD_REQUEST");
        assert_eq!(parse_id("0").unwrap_err().code(), "BAD_REQUEST");
        assert_eq!(parse_id("-3").unwrap_err().code(), "BAD_REQUEST");
        assert_eq!(parse_id("1.5").unwrap_err().code(), "BAD_REQUEST");
    }

    #[test]
    fn validate_content_trims_and_rejects_empty() {
        assert_eq!(validate_content("  hi  ").unwrap(), "hi");
        assert_eq!(validate_content("").unwrap_err().code(), "BAD_REQUEST");
        assert_eq!(validate_content("   ").unwrap_err().code(), "BAD_REQUEST");
    }

    // ── workflows (fake repo) ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn get_post_invalid_id_is_bad_request() {
        let svc = service();
        let err = svc.get_post("nope").await.unwrap_err();
        assert_eq!(err, FeedError::BadRequest("bad request".into()));
    }

    #[tokio::test]
    async fn get_post_unknown_is_not_found() {
        let svc = service();
        let err = svc.get_post("999").await.unwrap_err();
        assert_eq!(err, FeedError::NotFound("not found".into()));
    }

    #[tokio::test]
    async fn like_unknown_post_is_not_found() {
        let svc = service();
        let err = svc.like_post(ALICE_ID, "999").await.unwrap_err();
        assert_eq!(err, FeedError::NotFound("not found".into()));
    }

    #[tokio::test]
    async fn create_post_blank_content_is_bad_request() {
        for bad in ["", "   ", "\t\n"] {
            let svc = service();
            let err = svc.create_post(ALICE_ID, bad).await.unwrap_err();
            assert_eq!(err.code(), "BAD_REQUEST");
        }
    }

    #[tokio::test]
    async fn get_me_unknown_user_is_not_found() {
        let svc = service();
        let err = svc.get_me(999).await.unwrap_err();
        assert_eq!(err, FeedError::NotFound("not found".into()));
    }

    // ── happy paths ───────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn get_me_returns_the_user() {
        let svc = service();
        let me = svc.get_me(ALICE_ID).await.unwrap();
        assert_eq!(me.id, ALICE_ID);
        assert_eq!(me.username, "user_000001");
    }

    #[tokio::test]
    async fn get_feed_returns_posts() {
        let svc = service();
        let feed = svc.get_feed().await.unwrap();
        assert_eq!(feed.len(), 1);
        assert_eq!(feed[0].like_count, 2);
    }

    #[tokio::test]
    async fn get_post_returns_the_post() {
        let svc = service();
        let got = svc.get_post("10").await.unwrap();
        assert_eq!(got.id, KNOWN_POST_ID);
    }

    #[tokio::test]
    async fn like_known_post_is_idempotent() {
        let svc = service();
        svc.like_post(ALICE_ID, "10").await.unwrap(); // no error
        svc.like_post(ALICE_ID, "10").await.unwrap(); // ON CONFLICT DO NOTHING semantics
    }

    #[tokio::test]
    async fn create_post_validates_then_persists() {
        let svc = service();
        let created = svc.create_post(ALICE_ID, "  first post ").await.unwrap();
        assert_eq!(created.content, "first post");
        assert_eq!(created.like_count, 0);
        assert_eq!(created.user_id, ALICE_ID);
    }
}