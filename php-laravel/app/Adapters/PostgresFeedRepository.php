<?php

declare(strict_types=1);

namespace App\Adapters;

use App\Domain\Errors\NotFoundError;
use App\Domain\Models\Post;
use App\Domain\Models\User;
use App\Domain\Ports\FeedRepository;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Driven adapter: PostgreSQL FeedRepository. Owns the raw SQL (verbatim from
 * docs/../infra/api-contract.md) and maps rows (stdClass) → domain models. The only
 * place in the app that talks to the database.
 */
final class PostgresFeedRepository implements FeedRepository
{
    /** Shared post-query prefix (author join + like count), used verbatim. */
    private const SQL_POST = <<<'SQL'
        SELECT p.id, p.user_id, u.username, u.display_name, p.content, p.posted_at,
               (SELECT count(*) FROM likes l WHERE l.post_id = p.id) AS like_count
        FROM posts p
        JOIN users u ON u.id = p.user_id
    SQL;

    public function findUserById(int $id): ?User
    {
        $rows = DB::select('SELECT id, username, display_name FROM users WHERE id = $1', [$id]);
        if ($rows === []) {
            return null;
        }
        $u = $rows[0];

        return new User((int) $u->id, $u->username, $u->display_name);
    }

    public function feed(): array
    {
        $rows = DB::select(self::SQL_POST.' ORDER BY p.posted_at DESC, p.id DESC LIMIT 20');

        return array_map(fn ($row) => $this->toPost($row), $rows);
    }

    public function findPostById(int $id): ?Post
    {
        $rows = DB::select(self::SQL_POST.' WHERE p.id = $1', [$id]);

        return $rows === [] ? null : $this->toPost($rows[0]);
    }

    public function like(int $userId, int $postId): void
    {
        try {
            DB::statement(
                'INSERT INTO likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [$userId, $postId],
            );
        } catch (\Illuminate\Database\QueryException $e) {
            // SQLSTATE 23503: acting user doesn't exist (post is pre-checked) → 404 parity.
            if ($this->isForeignKeyViolation($e)) {
                throw new NotFoundError();
            }
            throw $e;
        }
    }

    public function createPost(int $userId, string $content): Post
    {
        try {
            $created = DB::select(
                'INSERT INTO posts (user_id, content) VALUES ($1, $2) RETURNING id, posted_at',
                [$userId, $content],
            );
        } catch (\Illuminate\Database\QueryException $e) {
            // SQLSTATE 23503: acting user doesn't exist → 404 parity.
            if ($this->isForeignKeyViolation($e)) {
                throw new NotFoundError();
            }
            throw $e;
        }

        return $this->findPostById((int) $created[0]->id);
    }

    /** Is this a Postgres foreign-key violation (SQLSTATE 23503)? */
    private function isForeignKeyViolation(\Illuminate\Database\QueryException $e): bool
    {
        $prev = $e->getPrevious();
        $info = $prev instanceof \PDOException ? $prev->errorInfo : null;

        return is_array($info) && ($info[0] ?? '') === '23503';
    }

    /** Map a raw row (stdClass) to the domain Post model. */
    private function toPost(\stdClass $p): Post
    {
        return new Post(
            id: (int) $p->id,
            userId: (int) $p->user_id,
            username: $p->username,
            displayName: $p->display_name,
            content: $p->content,
            postedAt: CarbonImmutable::parse($p->posted_at)->utc()->toImmutable(),
            likeCount: (int) $p->like_count,
        );
    }
}