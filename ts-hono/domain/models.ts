// ─── Domain models: pure data, zero imports, zero side effects ───────────────

/** The acting-user id carried by the bearer token (a positive integer). */
export type UserId = number;

/** A post id as seen on the wire (a positive integer ≤ 500_000). */
export type PostId = number;

/** A user (author). `id` is the acting-user id the bearer token carries. */
export interface User {
  readonly id: number;
  readonly username: string;
  readonly displayName: string;
}

/** A feed item: author snapshot + like count, `postedAt` as a UTC Date. */
export interface Post {
  readonly id: number;
  readonly userId: number;
  readonly username: string;
  readonly displayName: string;
  readonly content: string;
  readonly postedAt: Date;
  readonly likeCount: number;
}

/** Constructor helper — domain models are frozen, immutable plain data. */
export function user(id: number, username: string, displayName: string): User {
  return Object.freeze({ id, username, displayName });
}

/** Shape accepted by the {@link post} factory. */
export interface PostInput {
  id: number;
  userId: number;
  username: string;
  displayName: string;
  content: string;
  postedAt: Date;
  likeCount: number;
}

/** Constructor helper — freezes a post into an immutable domain model. */
export function post(input: PostInput): Post {
  return Object.freeze({ ...input });
}