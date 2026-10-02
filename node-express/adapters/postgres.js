'use strict';

// ─── Driven adapter: PostgreSQL FeedRepository ─────────────────────────────────
// Owns the raw SQL (verbatim from ../infra/api-contract.md) and maps rows → domain
// models. Depends only on `pg` + the port contract; no app imports beyond models.

const { Pool } = require('pg');
const { post } = require('../domain/models');

// Raw shared SQL (identical across all 8 stacks).
const POST_SELECT = `
  SELECT p.id, p.user_id, u.username, u.display_name, p.content, p.posted_at,
         (SELECT count(*) FROM likes l WHERE l.post_id = p.id) AS like_count
  FROM posts p
  JOIN users u ON u.id = p.user_id`;

function rowToPost(row) {
  return post({
    id: Number(row.id),
    userId: Number(row.user_id),
    username: row.username,
    displayName: row.display_name,
    content: row.content,
    postedAt: row.posted_at, // pg returns a JS Date (UTC)
    likeCount: Number(row.like_count === null ? 0 : row.like_count),
  });
}

/**
 * @param {object} config frozen { connectionUri, poolSize, maxPoolSize? } — see infra/config.js
 * @param {Date|(row)=>Date} _clock unused here; kept for port parity
 */
function createPostgresFeedRepository(config) {
  const pool = new Pool({ connectionString: config.connectionUri, max: config.poolSize });

  return {
    async findByUserId(userId) {
      const { rows } = await pool.query(
        'SELECT id, username, display_name FROM users WHERE id = $1', [userId]);
      if (rows.length === 0) return null;
      return { id: Number(rows[0].id), username: rows[0].username, displayName: rows[0].display_name };
    },

    async feed() {
      const { rows } = await pool.query(`${POST_SELECT} ORDER BY p.posted_at DESC, p.id DESC LIMIT 20`);
      return rows.map(rowToPost);
    },

    async findPostById(postId) {
      const { rows } = await pool.query(`${POST_SELECT} WHERE p.id = $1`, [postId]);
      return rows.length === 0 ? null : rowToPost(rows[0]);
    },

    async like(userId, postId) {
      await pool.query(
        'INSERT INTO likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, postId]);
    },

    async createPost(userId, content) {
      const { rows } = await pool.query(
        'INSERT INTO posts (user_id, content) VALUES ($1, $2) RETURNING id, user_id, posted_at',
        [userId, content]);
      const r = rows[0];
      // Author snapshot from the users table (single extra lookup, same as reference).
      const author = await this.findByUserId(userId);
      return post({
        id: Number(r.id),
        userId: Number(r.user_id),
        username: author.username,
        displayName: author.displayName,
        content,
        postedAt: r.posted_at,
        likeCount: 0,
      });
    },

    /** Adapter lifecycle hook: release the pool (register with LifetimePort in main). */
    async close() {
      await pool.end();
    },
  };
}

module.exports = { createPostgresFeedRepository, rowToPost };