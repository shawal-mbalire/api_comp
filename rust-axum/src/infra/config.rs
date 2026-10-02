//! Infra: config plumbing — the ONLY place environment variables are read.
//!
//! Env vars (docs/../infra/api-contract.md): `PORT` (8082), `DATABASE_URL`,
//! `POOL_SIZE` (10, the experiment's hard limit per process).

const DEFAULT_PORT: u16 = 8082;
const DEFAULT_DATABASE_URL: &str = "postgres://app:app@db:5432/app";
const DEFAULT_POOL_SIZE: u32 = 10;

/// Typed runtime config consumed by the composition root.
#[derive(Debug, Clone)]
pub struct AppConfig {
    /// TCP port the HTTP server binds.
    pub port: u16,
    /// PostgreSQL connection string.
    pub database_url: String,
    /// Max pool connections per process.
    pub pool_size: u32,
}

/// Parse a positive u16 from an env var, falling back to `default`.
fn env_u16(key: &str, default: u16) -> u16 {
    match std::env::var(key) {
        Ok(raw) => match raw.parse::<u16>() {
            Ok(v) if v > 0 => v,
            _ => default,
        },
        Err(_) => default,
    }
}

/// Parse a positive u32 from an env var, falling back to `default`.
fn env_u32(key: &str, default: u32) -> u32 {
    match std::env::var(key) {
        Ok(raw) => match raw.parse::<u32>() {
            Ok(v) if v > 0 => v,
            _ => default,
        },
        Err(_) => default,
    }
}

impl AppConfig {
    /// Load configuration from the process environment.
    pub fn from_env() -> Self {
        Self {
            port: env_u16("PORT", DEFAULT_PORT),
            database_url: std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| DEFAULT_DATABASE_URL.to_string()),
            pool_size: env_u32("POOL_SIZE", DEFAULT_POOL_SIZE),
        }
    }
}