'use strict';

// ─── Ports: contracts the domain needs fulfilled. In JS these are documented
//     interfaces (duck typing) — fakes in tests and the real adapter both
//     implement them. See ../infra/api-contract.md for the SQL source of truth.

/**
 * FeedRepository port — the data access boundary.
 *
 * Implementations: adapters/postgres.js (the benchmark PostgreSQL adapter).
 * A second implementation (SQLite, from the video's follow-up experiment) can
 * be dropped in without touching domain/workflows.js.
 *
 * @typedef {import('./models')} models
 * @typedef {object} FeedRepository
 * @property {(userId: number) => Promise<models.User|null>} findByUserId
 *   SELECT id, username, display_name FROM users WHERE id = $1
 * @property {() => Promise<models.Post[]>} feed
 *   The 20 newest posts (author + like count): ORDER BY posted_at DESC, id DESC LIMIT 20
 * @property {(postId: number) => Promise<models.Post|null>} findPostById
 *   Single post with author + like count.
 * @property {(userId: number, postId: number) => Promise<void>} like
 *   INSERT INTO likes ... ON CONFLICT DO NOTHING (idempotent).
 * @property {(userId: number, content: string) => Promise<models.Post>} createPost
 *   INSERT INTO posts ... RETURNING id, posted_at; author from users.
 */

/**
 * Clock port — for measuring process duration / startup diagnostics.
 * @typedef {object} Clock
 * @property {() => number} now returns epoch milliseconds
 */

module.exports = {}; // documentation only