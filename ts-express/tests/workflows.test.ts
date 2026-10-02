// Unit tests for domain/workflows.ts using a fake FeedRepository (pure, in-memory).
// Run: node --test tests/   (Node 24+ type stripping; `npm run typecheck` first)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeedService, parseId, validateContent } from '../domain/workflows.ts';
import { BadRequestError, NotFoundError } from '../domain/errors.ts';
import { post, user } from '../domain/models.ts';
import type { FeedRepository } from '../domain/ports.ts';

// ── fixtures ────────────────────────────────────────────────────────────────
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

function fakeRepository(overrides: Partial<FeedRepository> = {}): FeedRepository {
  const likes: Array<{ userId: number; postId: number }> = [];
  const repository: FeedRepository = {
    async findByUserId(id: number) {
      return id === ALICE.id ? ALICE : null;
    },
    async feed() {
      return [A_POST];
    },
    async findPostById(id: number) {
      return id === A_POST.id ? A_POST : null;
    },
    async like(userId: number, postId: number) {
      likes.push({ userId, postId });
    },
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
  return { ...repository, ...overrides };
}

// ── pure functions ──────────────────────────────────────────────────────────
test('parseId accepts positive integers only', () => {
  assert.equal(parseId('7'), 7);
  assert.throws(() => parseId('abc'), BadRequestError);
  assert.throws(() => parseId('0'), BadRequestError);
  assert.throws(() => parseId('-3'), BadRequestError);
  assert.throws(() => parseId('1.5'), BadRequestError);
});

test('validateContent trims and rejects empty', () => {
  assert.equal(validateContent('  hi  '), 'hi');
  assert.throws(() => validateContent('   '), BadRequestError);
  assert.throws(() => validateContent(''), BadRequestError);
  assert.throws(() => validateContent(42), BadRequestError);
});

// ── workflows (fake repo) ───────────────────────────────────────────────────
test('getMe returns the user; unknown id → NotFoundError', async () => {
  const svc = createFeedService(fakeRepository());
  const me = await svc.getMe(1);
  assert.equal(me.id, 1);
  await assert.rejects(() => svc.getMe(999), NotFoundError);
});

test('getFeed returns the posts', async () => {
  const svc = createFeedService(fakeRepository());
  const feed = await svc.getFeed(1);
  const first = feed[0];
  assert.equal(first?.likeCount, 2);
});

test('getPost maps 404/400 correctly', async () => {
  const svc = createFeedService(fakeRepository());
  const got = await svc.getPost(1, '10');
  assert.equal(got.id, 10);
  await assert.rejects(() => svc.getPost(1, '999'), NotFoundError);
  await assert.rejects(() => svc.getPost(1, 'nope'), BadRequestError);
});

test('likePost is idempotent; unknown post → NotFoundError', async () => {
  const repo = fakeRepository();
  const svc = createFeedService(repo);
  await svc.likePost(1, '10'); // no throw
  await svc.likePost(1, '10'); // idempotent by contract (ON CONFLICT DO NOTHING)
  await assert.rejects(() => svc.likePost(1, '999'), NotFoundError);
  await assert.rejects(() => svc.likePost(1, 'bad'), BadRequestError);
});

test('createPost validates content then persists', async () => {
  const svc = createFeedService(fakeRepository());
  const created = await svc.createPost(1, '  first post ');
  assert.equal(created.content, 'first post');
  assert.equal(created.likeCount, 0);
  await assert.rejects(() => svc.createPost(1, '  '), BadRequestError);
});