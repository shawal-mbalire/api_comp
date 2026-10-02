// ─── Driving adapter: Hono HTTP surface (on Bun) ──────────────────────────────
// Translates wire formats (authorization header, JSON bodies, path params) into
// domain calls via the FeedService, and maps domain results/errors → HTTP DTOs.
// No SQL here. No business rules here (rules live in domain/workflows.ts).
//
// Hono is the only web layer: a web-standard (Request/Response) framework with
// zero runtime dependencies beyond Bun's own fetch — no Express, no Node
// abstractions. Bun runs the .ts files natively.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { BadRequestError, NotFoundError } from '../domain/errors.ts';
import type { Post, User } from '../domain/models.ts';
import type { FeedService } from '../domain/workflows.ts';

/** Per-request variables this app carries (the acting user id). */
type AppBindings = { Variables: { userId: number } };

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
 * IS the numeric acting user id. Missing/malformed → null → 401 at the boundary.
 *
 * The token must be a bare positive integer; `Number()` alone would also accept
 * "7.0", "1e3", "0x10" or surrounding whitespace, diverging from the strict
 * parsers in the other stacks.
 */
function actingUserId(header: string | undefined): number | null {
  if (header === undefined) return null;

  const match = /^Bearer (\d+)$/.exec(header);
  if (match === null) return null;

  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Build the {"error": <message>} wire body for the given status. */
function errorJson(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/** Map a domain/unknown error to its contract response (adapter boundary). */
function domainErrorResponse(err: unknown): Response {
  if (err instanceof BadRequestError) return errorJson('bad request', 400);
  if (err instanceof NotFoundError) return errorJson('not found', 404);
  console.error(err);
  return errorJson('internal error', 500);
}

/** Read the optional `content` field; malformed JSON → 400 (never 500/422). */
async function readContent(c: Context<AppBindings>): Promise<unknown> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new BadRequestError('bad request');
  }

  const isObject = typeof body === 'object' && body !== null;
  const content = isObject ? (body as { content?: unknown }).content : undefined;
  return content;
}

/**
 * Build the Hono driving adapter wired to the FeedService.
 * @param service FeedService (domain workflows over the repo port)
 */
export function createHonoApp(service: FeedService): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  // Global error boundary: domain errors map to their contract status; anything
  // else is a 500. Keeps every route body to a single statement.
  app.onError((err, _c) => domainErrorResponse(err));

  // Auth gate for every /api/* route (all except /health per the contract).
  app.use('/api/*', async (c, next) => {
    const userId = actingUserId(c.req.header('authorization'));
    if (userId === null) {
      c.status(401);
      return c.json({ error: 'unauthorized' });
    }
    c.set('userId', userId);
    await next();
  });

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.get('/api/me', async (c) => {
    const user = await service.getMe(c.get('userId'));
    return c.json(userDto(user));
  });

  app.get('/api/feed', async (c) => {
    const posts = await service.getFeed(c.get('userId'));
    return c.json(posts.map(postDto));
  });

  app.get('/api/posts/:id', async (c) => {
    const post = await service.getPost(c.get('userId'), c.req.param('id'));
    return c.json(postDto(post));
  });

  app.post('/api/posts/:id/like', async (c) => {
    await service.likePost(c.get('userId'), c.req.param('id'));
    return new Response(null, { status: 204 });
  });

  app.post('/api/posts', async (c) => {
    const content = await readContent(c);
    const created = await service.createPost(c.get('userId'), content);
    return c.json(postDto(created), 201);
  });

  return app;
}