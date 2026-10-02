'use strict';

// ─── Driving adapter: Express HTTP surface ─────────────────────────────────────
// Translates wire formats (authorization header, JSON bodies, path params) into
// domain calls via the FeedService, and maps domain results/errors → HTTP DTOs.
// No SQL here. No business rules here (rules live in domain/workflows.js).

const express = require('express');
const { BadRequestError, NotFoundError } = require('../domain/errors');

/** ISO-8601 UTC with milliseconds: "2026-07-01T12:00:00.000Z". Pure. */
function formatIso(date) {
  return date.toISOString();
}

function postDto(post) {
  return {
    id: post.id,
    userId: post.userId,
    username: post.username,
    displayName: post.displayName,
    content: post.content,
    postedAt: formatIso(post.postedAt),
    likeCount: post.likeCount,
  };
}

function userDto(user) {
  return { id: user.id, username: user.username, displayName: user.displayName };
}

/**
 * Benchmark simplification: `Authorization: Bearer <user_id>` — the bearer token
 * IS the numeric acting user id. Missing/malformed → 401 at this boundary.
 * @returns {number|null}
 */
function actingUserId(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function requireAuth(req, res, next) {
  const id = actingUserId(req);
  if (id === null) return res.status(401).json({ error: 'unauthorized' });
  req.userId = id;
  next();
}

/**
 * Build the Express router (driving adapter wiring).
 * @param {object} service FeedService (domain workflows over the repo port)
 */
function createHttpApp(service) {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.get('/api/me', requireAuth, async (req, res) => {
    try {
      res.json(userDto(await service.getMe(req.userId)));
    } catch (e) {
      handleDomainError(e, res);
    }
  });

  app.get('/api/feed', requireAuth, async (_req, res) => {
    try {
      const posts = await service.getFeed(0); // acting user not needed for the global feed
      res.json(posts.map(postDto));
    } catch (e) {
      handleDomainError(e, res);
    }
  });

  app.get('/api/posts/:id', requireAuth, async (req, res) => {
    try {
      res.json(postDto(await service.getPost(req.userId, req.params.id)));
    } catch (e) {
      handleDomainError(e, res);
    }
  });

  app.post('/api/posts/:id/like', requireAuth, async (req, res) => {
    try {
      await service.likePost(req.userId, req.params.id);
      res.status(204).end();
    } catch (e) {
      handleDomainError(e, res);
    }
  });

  app.post('/api/posts', requireAuth, async (req, res) => {
    try {
      const created = await service.createPost(req.userId, req.body && req.body.content);
      res.status(201).json(postDto(created));
    } catch (e) {
      handleDomainError(e, res);
    }
  });

  return app;
}

/** Map domain errors to HTTP; anything else is a 500 (adapter boundary). */
function handleDomainError(err, res) {
  if (err instanceof BadRequestError) return res.status(400).json({ error: 'bad request' });
  if (err instanceof NotFoundError) return res.status(404).json({ error: 'not found' });
  console.error(err);
  res.status(500).json({ error: 'internal error' });
}

module.exports = { createHttpApp, actingUserId, formatIso, postDto };