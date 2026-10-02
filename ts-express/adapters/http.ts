// ─── Driving adapter: Express HTTP surface ─────────────────────────────────────
// Translates wire formats (authorization header, JSON bodies, path params) into
// domain calls via the FeedService, and maps domain results/errors → HTTP DTOs.
// No SQL here. No business rules here (rules live in domain/workflows.ts).

import express from 'express';
import type { Request, RequestHandler, Response } from 'express';
import { BadRequestError, NotFoundError } from '../domain/errors.ts';
import type { Post, User } from '../domain/models.ts';
import type { FeedService } from '../domain/workflows.ts';

/** ISO-8601 UTC with milliseconds: "2026-07-01T12:00:00.000Z". Pure. */
function formatIso(date: Date): string {
  return date.toISOString();
}

function postDto(post: Post): Record<string, unknown> {
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

function userDto(user: User): Record<string, unknown> {
  return { id: user.id, username: user.username, displayName: user.displayName };
}

/**
 * Benchmark simplification: `Authorization: Bearer <user_id>` — the bearer token
 * IS the numeric acting user id. Missing/malformed → 401 at this boundary.
 *
 * The token must be a bare positive integer; `Number()` alone would also accept
 * "7.0", "1e3", "0x10" or surrounding whitespace, diverging from the strict
 * parsers in the other stacks.
 */
function actingUserId(req: Request): number | null {
  const header = req.headers.authorization;
  if (header === undefined) return null;

  const match = /^Bearer (\d+)$/.exec(header);
  if (match === null) return null;

  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Wrap an auth-gated handler. Resolves the acting user id (401 otherwise) and
 * passes it as a typed argument so handlers never re-parse the header.
 */
function authenticated(
  handler: (req: Request, res: Response, userId: number) => void | Promise<void>,
): RequestHandler {
  return (req, res) => {
    const userId = actingUserId(req);
    if (userId === null) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    // Express 5 forwards returned (rejected) promises to the error handler.
    return handler(req, res, userId);
  };
}

/** Map domain errors to HTTP; anything else is a 500 (adapter boundary). */
function handleDomainError(err: unknown, res: Response): void {
  if (err instanceof BadRequestError) {
    res.status(400).json({ error: 'bad request' });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'internal error' });
}

/**
 * Build the Express router (driving adapter wiring).
 * @param service FeedService (domain workflows over the repo port)
 */
export function createHttpApp(service: FeedService): ReturnType<typeof express> {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/me', authenticated(async (_req, res, userId) => {
    try {
      const user = await service.getMe(userId);
      res.json(userDto(user));
    } catch (err) {
      handleDomainError(err, res);
    }
  }));

  app.get('/api/feed', authenticated(async (_req, res, userId) => {
    try {
      const posts = await service.getFeed(userId);
      res.json(posts.map(postDto));
    } catch (err) {
      handleDomainError(err, res);
    }
  }));

  app.get('/api/posts/:id', authenticated(async (req, res, userId) => {
    try {
      const rawId = req.params.id;
      if (typeof rawId !== 'string') {
        res.status(400).json({ error: 'bad request' });
        return;
      }
      const post = await service.getPost(userId, rawId);
      res.json(postDto(post));
    } catch (err) {
      handleDomainError(err, res);
    }
  }));

  app.post('/api/posts/:id/like', authenticated(async (req, res, userId) => {
    try {
      const rawId = req.params.id;
      if (typeof rawId !== 'string') {
        res.status(400).json({ error: 'bad request' });
        return;
      }
      await service.likePost(userId, rawId);
      res.status(204).end();
    } catch (err) {
      handleDomainError(err, res);
    }
  }));

  app.post('/api/posts', authenticated(async (req, res, userId) => {
    try {
      const body = req.body as { content?: unknown } | undefined;
      const created = await service.createPost(userId, body?.content);
      res.status(201).json(postDto(created));
    } catch (err) {
      handleDomainError(err, res);
    }
  }));

  return app;
}