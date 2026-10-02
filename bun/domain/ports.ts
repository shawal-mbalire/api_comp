// ─── Ports: contracts the domain needs fulfilled. The fakes in tests and the
//     real Postgres adapter both implement these interfaces. See
//     ../infra/api-contract.md for the SQL source of truth.

import type { Post, User } from './models.ts';

/** FeedRepository port — the data-access boundary. */
export interface FeedRepository {
  /** SELECT id, username, display_name FROM users WHERE id = $1 */
  findByUserId(userId: number): Promise<User | null>;
  /** The 20 newest posts (author + like count): ORDER BY posted_at DESC, id DESC LIMIT 20 */
  feed(): Promise<Post[]>;
  /** Single post with author + like count. */
  findPostById(postId: number): Promise<Post | null>;
  /** INSERT INTO likes ... ON CONFLICT DO NOTHING (idempotent). */
  like(userId: number, postId: number): Promise<void>;
  /** INSERT INTO posts ... RETURNING id, posted_at; author from users. */
  createPost(userId: number, content: string): Promise<Post>;
}

/** Clock port — for measuring process duration / startup diagnostics. */
export interface Clock {
  /** Returns epoch milliseconds. */
  now(): number;
}