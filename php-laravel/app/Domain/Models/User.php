<?php

declare(strict_types=1);

namespace App\Domain\Models;

/** Pure domain model: an author / acting user. */
final readonly class User
{
    public function __construct(
        public int $id,
        public string $username,
        public string $displayName,
    ) {
    }
}