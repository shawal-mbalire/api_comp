//! Adapters layer — hexagonal ports & adapters.
//!
//! - `http`    : driving adapter (Axum HTTP surface, translates HTTP ⇄ domain)
//! - `postgres`: driven adapter (PostgreSQL behind the FeedRepository port)

pub mod http;
pub mod postgres;