<?php

declare(strict_types=1);

namespace App\Domain\Ports;

use App\Domain\Models\Post;
use App\Domain\Models\User;

/**
 * FeedRepository port — the data-access boundary the domain needs fulfilled.
 *
 * Implemented by App\Adapters\PostgresFeedRepository (raw SQL via Laravel's DB
 * facade / PDO). A second implementation (SQLite — the video's follow-up
 * experiment) can be added without touching the workflows.
 */
interface FeedRepository
{
    /** SELECT id, username, display_name FROM users WHERE id = $1 */
    public function findUserById(int $id): ?User;

    /** The 20 newest posts: ORDER BY posted_at DESC, id DESC LIMIT 20 */
    public function feed(): array;

    /** Single post with author + like count. */
    public function findPostById(int $id): ?Post;

    /** Idempotent like: INSERT INTO likes ... ON CONFLICT DO NOTHING. */
    public function like(int $userId, int $postId): void;

    /** INSERT INTO posts ... RETURNING id, posted_at; author snapshot. */
    public function createPost(int $userId, string $content): Post;
}