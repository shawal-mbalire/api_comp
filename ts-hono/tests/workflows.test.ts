// Unit tests for domain/workflows.ts using a fake FeedRepository (pure, in-memory).
// Run: bun test tests/

import { test, expect } from 'bun:test';
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
  expect(parseId('7')).toBe(7);
  expect(() => parseId('abc')).toThrow(BadRequestError);
  expect(() => parseId('0')).toThrow(BadRequestError);
  expect(() => parseId('-3')).toThrow(BadRequestError);
  expect(() => parseId('1.5')).toThrow(BadRequestError);
});

test('validateContent trims and rejects empty', () => {
  expect(validateContent('  hi  ')).toBe('hi');
  expect(() => validateContent('   ')).toThrow(BadRequestError);
  expect(() => validateContent('')).toThrow(BadRequestError);
  expect(() => validateContent(42)).toThrow(BadRequestError);
});

// ── workflows (fake repo) ───────────────────────────────────────────────────
test('getMe returns the user; unknown id → NotFoundError', async () => {
  const svc = createFeedService(fakeRepository());
  const me = await svc.getMe(1);
  expect(me.id).toBe(1);
  expect(svc.getMe(999)).rejects.toThrow(NotFoundError);
});

test('getFeed returns the posts', async () => {
  const svc = createFeedService(fakeRepository());
  const feed = await svc.getFeed(1);
  expect(feed[0]?.likeCount).toBe(2);
});

test('getPost maps 404/400 correctly', async () => {
  const svc = createFeedService(fakeRepository());
  const got = await svc.getPost(1, '10');
  expect(got.id).toBe(10);
  expect(svc.getPost(1, '999')).rejects.toThrow(NotFoundError);
  expect(svc.getPost(1, 'nope')).rejects.toThrow(BadRequestError);
});

test('likePost is idempotent; unknown post → NotFoundError', async () => {
  const svc = createFeedService(fakeRepository());
  await svc.likePost(1, '10'); // no throw
  await svc.likePost(1, '10'); // idempotent by contract (ON CONFLICT DO NOTHING)
  expect(svc.likePost(1, '999')).rejects.toThrow(NotFoundError);
  expect(svc.likePost(1, 'bad')).rejects.toThrow(BadRequestError);
});

test('createPost validates content then persists', async () => {
  const svc = createFeedService(fakeRepository());
  const created = await svc.createPost(1, '  first post ');
  expect(created.content).toBe('first post');
  expect(created.likeCount).toBe(0);
  expect(svc.createPost(1, '  ')).rejects.toThrow(BadRequestError);
});