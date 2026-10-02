'use strict';

// ─── Domain workflows: pure orchestrators. Each function validates its inputs
//     first, then drives the FeedRepository port. No I/O, no framework imports.

const { BadRequestError, NotFoundError } = require('./errors');

/** Parse and validate a positive integer id. Pure. */
function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestError('bad request');
  return id;
}

/** Validate post content. Pure. Returns trimmed content or throws. */
function validateContent(raw) {
  const content = typeof raw === 'string' ? raw.trim() : '';
  if (!content) throw new BadRequestError('content required');
  return content;
}

/** GET /api/me. Returns the acting user or NotFoundError. */
async function getMe(repo, userId) {
  const found = await repo.findByUserId(userId);
  if (!found) throw new NotFoundError('not found');
  return found;
}

/** GET /api/feed. Returns the 20 newest posts. */
async function getFeed(repo, _userId) {
  return repo.feed();
}

/** GET /api/posts/{id}. */
async function getPost(repo, _userId, rawId) {
  const id = parseId(rawId);
  const found = await repo.findPostById(id);
  if (!found) throw new NotFoundError('not found');
  return found;
}

/** POST /api/posts/{id}/like → 204, or 404 when the post is missing. */
async function likePost(repo, userId, rawId) {
  const id = parseId(rawId);
  const post = await repo.findPostById(id);
  if (!post) throw new NotFoundError('not found');
  await repo.like(userId, id);
  return null;
}

/** POST /api/posts → 201 with the created post. */
async function createPost(repo, userId, rawContent) {
  const content = validateContent(rawContent);
  return repo.createPost(userId, content);
}

/**
 * Assemble the FeedService — a namespace of the workflows above. Domain code
 * depends only on the port (repo), never on adapters.
 */
function createFeedService(repo) {
  return {
    getMe: (u) => getMe(repo, u),
    getFeed: (u) => getFeed(repo, u),
    getPost: (u, id) => getPost(repo, u, id),
    likePost: (u, id) => likePost(repo, u, id),
    createPost: (u, c) => createPost(repo, u, c),
  };
}

module.exports = { parseId, validateContent, createFeedService };