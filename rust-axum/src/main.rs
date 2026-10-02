//! Composition root — the only place modules are wired together.
//!
//! Reads config → creates the pool → builds the driven adapter (Postgres) →
//! builds the domain FeedService → builds the driver adapter (Axum Router) →
//! serves. No business logic here.

mod adapters;
mod domain;
mod infra;

use std::sync::Arc;

use sqlx::postgres::PgPoolOptions;
use tokio::net::TcpListener;

use adapters::http::{build_router, AppState};
use adapters::postgres::PostgresFeedRepository;
use domain::workflows::FeedService;
use infra::config::AppConfig;

/// Wait for ctrl_c (SIGINT) or SIGTERM, then let axum drain gracefully.
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install ctrl_c handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
    println!("shutdown signal received, draining connections");
}

#[tokio::main]
async fn main() {
    let config = AppConfig::from_env();

    // Driven adapter: PostgreSQL behind the FeedRepository port.
    // Hard experiment limit: exactly POOL_SIZE connections per process.
    let pool = PgPoolOptions::new()
        .max_connections(config.pool_size)
        .connect(&config.database_url)
        .await
        .expect("failed to connect to postgres");

    // Keep a handle to close the pool during graceful shutdown (PgPool is
    // cheaply cloneable — an Arc).
    let repository = PostgresFeedRepository::new(pool.clone());

    // Domain workflows — depend only on the port.
    let service = Arc::new(FeedService::new(Box::new(repository)));

    // Driving adapter: Axum HTTP surface (auth extraction, DTOs, error mapping).
    let app = build_router(AppState::new(service));

    let listener = TcpListener::bind(("0.0.0.0", config.port))
        .await
        .expect("failed to bind port");

    println!(
        "backend-rust-axum listening on http://0.0.0.0:{} (pool size {})",
        config.port, config.pool_size
    );

    // Serve until a shutdown signal arrives, then drain in-flight requests.
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("server error");

    // Release the connection pool on the way out.
    pool.close().await;
    println!("connection pool closed");
}