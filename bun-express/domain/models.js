'use strict';

// ─── Domain models: pure data, zero imports, zero side effects ───────────────

/**
 * A user (author). `id` is the acting-user id that the bearer token carries.
 * @param {number} id
 * @param {string} username
 * @param {string} displayName
 */
function user(id, username, displayName) {
  return Object.freeze({ id, username, displayName });
}

/**
 * A post with author snapshot and like count.
 * @param {object} p { id, userId, username, displayName, content, postedAt(Date), likeCount }
 */
function post(p) {
  return Object.freeze({
    id: p.id,
    userId: p.userId,
    username: p.username,
    displayName: p.displayName,
    content: p.content,
    postedAt: p.postedAt, // Date (UTC)
    likeCount: p.likeCount,
  });
}

module.exports = { user, post };