<?php

declare(strict_types=1);

namespace App\Domain\Models;

use DateTimeImmutable;

/** Pure domain model: a feed post with an author snapshot and like count. */
final readonly class Post
{
    public function __construct(
        public int $id,
        public int $userId,
        public string $username,
        public string $displayName,
        public string $content,
        public DateTimeImmutable $postedAt, // UTC
        public int $likeCount,
    ) {
    }
}