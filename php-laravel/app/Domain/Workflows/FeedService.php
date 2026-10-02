<?php

declare(strict_types=1);

namespace App\Domain\Workflows;

use App\Domain\Errors\BadRequestError;
use App\Domain\Errors\NotFoundError;
use App\Domain\Models\Post;
use App\Domain\Models\User;
use App\Domain\Ports\FeedRepository;

/**
 * FeedService — the application workflow layer. Pure orchestrators: each method
 * validates its inputs first (fail fast), then drives the FeedRepository port.
 * No HTTP, no DB, no Laravel container here — adapters handle the rest.
 */
final class FeedService
{
    public function __construct(private readonly FeedRepository $repo)
    {
    }

    /** Parse and validate a positive integer id. Pure. */
    public static function parseId(string $raw): int
    {
        if (preg_match('/^[0-9]+$/', $raw) !== 1 || (int) $raw <= 0) {
            throw new BadRequestError();
        }

        return (int) $raw;
    }

    /** Validate post content. Pure. Returns trimmed content or throws. */
    public static function validateContent(mixed $raw): string
    {
        $content = is_string($raw) ? trim($raw) : '';
        if ($content === '') {
            throw new BadRequestError('content required');
        }

        return $content;
    }

    /** GET /api/me */
    public function getMe(int $actingUser): User
    {
        $user = $this->repo->findUserById($actingUser);
        if ($user === null) {
            throw new NotFoundError();
        }

        return $user;
    }

    /** GET /api/feed — 20 newest posts. */
    public function getFeed(int $actingUser): array
    {
        return $this->repo->feed();
    }

    /** GET /api/posts/{id} */
    public function getPost(int $actingUser, string $rawId): Post
    {
        $post = $this->repo->findPostById(self::parseId($rawId));
        if ($post === null) {
            throw new NotFoundError();
        }

        return $post;
    }

    /** POST /api/posts/{id}/like → 204; 404 when the post is missing. */
    public function likePost(int $actingUser, string $rawId): void
    {
        $post = $this->repo->findPostById(self::parseId($rawId));
        if ($post === null) {
            throw new NotFoundError();
        }
        $this->repo->like($actingUser, $post->id);
    }

    /** POST /api/posts → 201 with the created post. */
    public function createPost(int $actingUser, mixed $rawContent): Post
    {
        return $this->repo->createPost($actingUser, self::validateContent($rawContent));
    }
}