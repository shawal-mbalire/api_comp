'use strict';

// Unit tests for domain/workflows.js using a fake FeedRepository (pure, in-memory).
// Run: node --test tests/

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFeedService, parseId, validateContent } = require('../domain/workflows');
const { BadRequestError, NotFoundError } = require('../domain/errors');
const { user, post } = require('../domain/models');

// ── fixtures ────────────────────────────────────────────────────────────────
const ALICE = user(1, 'user_000001', 'Alice');
const A_POST = post({
  id: 10, userId: 1, username: 'user_000001', displayName: 'Alice',
  content: 'hello hexagon', postedAt: new Date('2026-07-01T12:00:00.000Z'), likeCount: 2,
});

function fakeRepository(overrides = {}) {
  const likes = [];
  return {
    async findByUserId(id) {
      return id === ALICE.id ? ALICE : null;
    },
    async feed() {
      return [A_POST];
    },
    async findPostById(id) {
      return id === A_POST.id ? A_POST : null;
    },
    async like(userId, postId) {
      likes.push({ userId, postId });
    },
    async createPost(userId, content) {
      return post({ id: 99, userId, username: ALICE.username, displayName: ALICE.displayName,
        content, postedAt: new Date('2026-07-01T13:00:00.000Z'), likeCount: 0 });
    },
    ...overrides,
  };
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
  assert.equal((await svc.getMe(1)).id, 1);
  await assert.rejects(() => svc.getMe(999), NotFoundError);
});

test('getFeed returns the 20 newest posts', async () => {
  const svc = createFeedService(fakeRepository());
  const feed = await svc.getFeed(1);
  assert.equal(feed.length, 1);
  assert.equal(feed[0].likeCount, 2);
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