// ─── Domain workflows: pure orchestrators. Each function validates its inputs
//     first, then drives the FeedRepository port. No I/O, no framework imports.

import { BadRequestError, NotFoundError } from './errors.ts';
import type { Post, User } from './models.ts';
import type { FeedRepository } from './ports.ts';

/** Parse and validate a positive integer id. Pure. */
export function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestError('bad request');
  return id;
}

/** Validate post content. Pure. Returns trimmed content or throws. */
export function validateContent(raw: unknown): string {
  const content = typeof raw === 'string' ? raw.trim() : '';
  if (!content) throw new BadRequestError('content required');
  return content;
}

/** GET /api/me — returns the acting user or NotFoundError. */
export async function getMe(repo: FeedRepository, userId: number): Promise<User> {
  const found = await repo.findByUserId(userId);
  if (found === null) throw new NotFoundError('not found');
  return found;
}

/** GET /api/feed — returns the 20 newest posts. */
export async function getFeed(repo: FeedRepository, _userId: number): Promise<Post[]> {
  return repo.feed();
}

/** GET /api/posts/{id} — 400 on a bad id, 404 on an unknown post. */
export async function getPost(repo: FeedRepository, _userId: number, rawId: string): Promise<Post> {
  const id = parseId(rawId);
  const found = await repo.findPostById(id);
  if (found === null) throw new NotFoundError('not found');
  return found;
}

/** POST /api/posts/{id}/like → 204, or 404 when the post is missing. */
export async function likePost(repo: FeedRepository, userId: number, rawId: string): Promise<void> {
  const id = parseId(rawId);
  const found = await repo.findPostById(id);
  if (found === null) throw new NotFoundError('not found');
  await repo.like(userId, id);
}

/** POST /api/posts → 201 with the created post. */
export async function createPost(
  repo: FeedRepository,
  userId: number,
  rawContent: unknown,
): Promise<Post> {
  const content = validateContent(rawContent);
  return repo.createPost(userId, content);
}

/** The application service surface the HTTP adapter depends on. */
export interface FeedService {
  getMe(userId: number): Promise<User>;
  getFeed(actingUser: number): Promise<Post[]>;
  getPost(actingUser: number, rawId: string): Promise<Post>;
  likePost(actingUser: number, rawId: string): Promise<void>;
  createPost(actingUser: number, rawContent: unknown): Promise<Post>;
}

/**
 * Assemble the FeedService — a namespace of the workflows above. Domain code
 * depends only on the port (repo), never on adapters.
 */
export function createFeedService(repo: FeedRepository): FeedService {
  return {
    getMe: (userId) => getMe(repo, userId),
    getFeed: (actingUser) => getFeed(repo, actingUser),
    getPost: (actingUser, rawId) => getPost(repo, actingUser, rawId),
    likePost: (actingUser, rawId) => likePost(repo, actingUser, rawId),
    createPost: (actingUser, rawContent) => createPost(repo, actingUser, rawContent),
  };
}