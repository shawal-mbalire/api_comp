// ─── Driven adapter: PostgreSQL FeedRepository ─────────────────────────────────
// Owns the raw SQL (verbatim from ../infra/api-contract.md) and maps rows → domain
// models. Depends only on `pg` + the port contract; no app imports beyond models.

import pg from 'pg';
import { NotFoundError } from '../domain/errors.ts';
import { post } from '../domain/models.ts';
import type { Post } from '../domain/models.ts';
import type { FeedRepository } from '../domain/ports.ts';

const { Pool } = pg;

// Raw shared SQL (identical across all 8 stacks).
const POST_SELECT = `
  SELECT p.id, p.user_id, u.username, u.display_name, p.content, p.posted_at,
         (SELECT count(*) FROM likes l WHERE l.post_id = p.id) AS like_count
  FROM posts p
  JOIN users u ON u.id = p.user_id`;

/** Raw user row as returned by Postgres (snake_case; BIGINT comes back as string). */
interface UserRow {
  id: string;
  username: string;
  display_name: string;
}

/** Raw post row as returned by Postgres (snake_case; counts come back as string|null). */
interface PostRow {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  content: string;
  posted_at: Date;
  like_count: string | null;
}

/** Row returned by `INSERT ... RETURNING` on the posts table. */
interface InsertedPostRow {
  id: string;
  user_id: string;
  posted_at: Date;
}

/** Is the given driver error a Postgres foreign-key violation (SQLSTATE 23503)? */
function isForeignKeyViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === '23503';
}

/** Map a raw row → the domain model (BIGINT columns are Number()-coerced). */
function rowToPost(row: PostRow): Post {
  return post({
    id: Number(row.id),
    userId: Number(row.user_id),
    username: row.username,
    displayName: row.display_name,
    content: row.content,
    postedAt: row.posted_at,
    likeCount: Number(row.like_count === null ? 0 : row.like_count),
  });
}

/** Options consumed by the factory — the frozen `infra/config` Config. */
export interface PostgresRepositoryOptions {
  readonly connectionUri: string;
  readonly poolSize: number;
}

/** The concrete repository type: the port plus its lifecycle hook. */
export interface ClosableFeedRepository extends FeedRepository {
  /** Release the connection pool (composition root calls this on shutdown). */
  close(): Promise<void>;
}

/**
 * Create the PostgreSQL-backed FeedRepository (the driven adapter).
 * @param config frozen { connectionUri, poolSize } — see infra/config.ts
 */
export function createPostgresFeedRepository(config: PostgresRepositoryOptions): ClosableFeedRepository {
  const pool = new Pool({ connectionString: config.connectionUri, max: config.poolSize });

  const repository: ClosableFeedRepository = {
    async findByUserId(userId: number) {
      const { rows } = await pool.query<UserRow>(
        'SELECT id, username, display_name FROM users WHERE id = $1',
        [userId],
      );
      const found = rows[0];
      if (found === undefined) return null;
      return { id: Number(found.id), username: found.username, displayName: found.display_name };
    },

    async feed() {
      const { rows } = await pool.query<PostRow>(
        `${POST_SELECT} ORDER BY p.posted_at DESC, p.id DESC LIMIT 20`,
      );
      return rows.map(rowToPost);
    },

    async findPostById(postId: number) {
      const { rows } = await pool.query<PostRow>(`${POST_SELECT} WHERE p.id = $1`, [postId]);
      const found = rows[0];
      return found === undefined ? null : rowToPost(found);
    },

    async like(userId: number, postId: number) {
      try {
        await pool.query(
          'INSERT INTO likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [userId, postId],
        );
      } catch (err) {
        // SQLSTATE 23503: acting user doesn't exist (post is pre-checked) →
        // 404, matching the other stacks.
        if (isForeignKeyViolation(err)) throw new NotFoundError('not found');
        throw err;
      }
    },

    async createPost(userId: number, content: string) {
      let inserted: InsertedPostRow | undefined;
      try {
        const { rows } = await pool.query<InsertedPostRow>(
          'INSERT INTO posts (user_id, content) VALUES ($1, $2) RETURNING id, user_id, posted_at',
          [userId, content],
        );
        inserted = rows[0];
      } catch (err) {
        // SQLSTATE 23503: acting user doesn't exist → 404 parity.
        if (isForeignKeyViolation(err)) throw new NotFoundError('not found');
        throw err;
      }
      if (inserted === undefined) {
        // INSERT ... RETURNING always yields exactly one row — defensive only.
        throw new NotFoundError('not found');
      }

      // Author snapshot from the users table (single extra lookup, same as reference).
      const author = await repository.findByUserId(userId);
      if (author === null) throw new NotFoundError('not found');

      return post({
        id: Number(inserted.id),
        userId: Number(inserted.user_id),
        username: author.username,
        displayName: author.displayName,
        content,
        postedAt: inserted.posted_at,
        likeCount: 0,
      });
    },

    async close() {
      await pool.end();
    },
  };

  return repository;
}