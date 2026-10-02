//! Domain layer — pure application logic. No axum / http / sqlx here.
//!
//! - `models`:   User, Post (plain data, snake_case internally)
//! - `errors`:   FeedError (BadRequest / NotFound / Database)
//! - `ports`:    FeedRepository trait (the data-access boundary)
//! - `workflows`: FeedService — validation + orchestration over the port

pub mod errors;
pub mod models;
pub mod ports;
pub mod workflows;