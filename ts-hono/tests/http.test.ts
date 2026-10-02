// HTTP-level tests for the Hono driving adapter (adapters/http.ts) via Hono's
// app.request() — no server socket and no database needed. Covers auth gating,
// status codes, contract JSON shapes, and error bodies end-to-end.
// Run: bun test tests/

import { test, expect } from 'bun:test';
import { createHonoApp } from '../adapters/http.ts';
import { createFeedService } from '../domain/workflows.ts';
import { post, user } from '../domain/models.ts';
import type { FeedRepository } from '../domain/ports.ts';

const ALICE = user(1, 'user_000001', 'Alice');
const A_POST = post({
  id: 10,
  userId: 1,
  username: 'user_000001',
  displayName: 'Alice',
  content: 'hello hexagon',
  postedAt: new Date('2026-07-01T12:00:00.000Z'),
  likeCount: 2,
});

function fakeRepository(): FeedRepository {
  return {
    async findByUserId(id: number) {
      return id === ALICE.id ? ALICE : null;
    },
    async feed() {
      return [A_POST];
    },
    async findPostById(id: number) {
      return id === A_POST.id ? A_POST : null;
    },
    async like(_userId: number, _postId: number) {},
    async createPost(userId: number, content: string) {
      return post({
        id: 99,
        userId,
        username: ALICE.username,
        displayName: ALICE.displayName,
        content,
        postedAt: new Date('2026-07-01T13:00:00.000Z'),
        likeCount: 0,
      });
    },
  };
}

const app = createHonoApp(createFeedService(fakeRepository()));
const authed = { Authorization: 'Bearer 1' } as const;

test('GET /health → 200 {"status":"ok"} without auth', async () => {
  const res = await app.request('/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok' });
});

test('GET /api/me without auth → 401 {"error":"unauthorized"}', async () => {
  const res = await app.request('/api/me');
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: 'unauthorized' });
});

test('malformed bearer tokens → 401', async () => {
  for (const token of ['7.0', '1e3', '0x10', ' 7 ', '', '0', '-1']) {
    const res = await app.request('/api/feed', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  }
});

test('GET /api/me → 200 user shape', async () => {
  const res = await app.request('/api/me', { headers: authed });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    id: 1,
    username: 'user_000001',
    displayName: 'Alice',
  });
});

test('GET /api/feed → 200 with camelCase post shape', async () => {
  const res = await app.request('/api/feed', { headers: authed });
  expect(res.status).toBe(200);
  const body = (await res.json()) as Array<Record<string, unknown>>;
  expect(body[0]).toEqual({
    id: 10,
    userId: 1,
    username: 'user_000001',
    displayName: 'Alice',
    content: 'hello hexagon',
    postedAt: '2026-07-01T12:00:00.000Z',
    likeCount: 2,
  });
});

test('GET /api/posts/:id → 200 / 404', async () => {
  const ok = await app.request('/api/posts/10', { headers: authed });
  expect(ok.status).toBe(200);

  const missing = await app.request('/api/posts/999', { headers: authed });
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: 'not found' });
});

test('POST /api/posts/:id/like → 204', async () => {
  const res = await app.request('/api/posts/10/like', { method: 'POST', headers: authed });
  expect(res.status).toBe(204);
});

test('POST /api/posts → 201 trimmed; blank → 400; malformed JSON → 400', async () => {
  const created = await app.request('/api/posts', {
    method: 'POST',
    headers: { ...authed, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '  hello hono  ' }),
  });
  expect(created.status).toBe(201);
  const body = (await created.json()) as Record<string, unknown>;
  expect(body.content).toBe('hello hono');
  expect(body.likeCount).toBe(0);

  const blank = await app.request('/api/posts', {
    method: 'POST',
    headers: { ...authed, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '   ' }),
  });
  expect(blank.status).toBe(400);
  expect(await blank.json()).toEqual({ error: 'bad request' });

  const malformed = await app.request('/api/posts', {
    method: 'POST',
    headers: { ...authed, 'Content-Type': 'application/json' },
    body: '{not json',
  });
  expect(malformed.status).toBe(400);
});