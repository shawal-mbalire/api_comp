<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Domain\Errors\BadRequestError;
use App\Domain\Errors\NotFoundError;
use App\Domain\Models\Post;
use App\Domain\Models\User;
use App\Domain\Ports\FeedRepository;
use App\Domain\Workflows\FeedService;
use PHPUnit\Framework\TestCase;

/** Unit tests for FeedService using a fake in-memory FeedRepository. */
final class FeedServiceTest extends TestCase
{
    public function testParseIdRejectsInvalid(): void
    {
        $this->assertSame(7, FeedService::parseId('7'));
        foreach (['abc', '0', '-3', '1.5'] as $bad) {
            try {
                FeedService::parseId($bad);
                $this->fail("expected BadRequestError for '$bad'");
            } catch (BadRequestError) {
            }
        }
    }

    public function testValidateContent(): void
    {
        $this->assertSame('hi', FeedService::validateContent('  hi  '));
        foreach (['   ', '', null, 42] as $bad) {
            try {
                FeedService::validateContent($bad);
                $this->fail('expected BadRequestError for '.var_export($bad, true));
            } catch (BadRequestError) {
            }
        }
    }

    public function testGetMeUnknownUser(): void
    {
        $service = new FeedService(new FakeRepo());
        $this->assertSame(1, $service->getMe(1)->id);
        $this->expectException(NotFoundError::class);
        $service->getMe(999);
    }

    public function testGetPostErrors(): void
    {
        $service = new FeedService(new FakeRepo());
        $this->assertSame(10, $service->getPost(1, '10')->id);
        $this->expectException(BadRequestError::class);
        $service->getPost(1, 'nope');
    }

    public function testLikeUnknownPost(): void
    {
        $service = new FeedService(new FakeRepo());
        $this->expectException(NotFoundError::class);
        $service->likePost(1, '999');
    }

    public function testCreateBlankContent(): void
    {
        $service = new FeedService(new FakeRepo());
        try {
            $service->createPost(1, '   ');
            $this->fail('expected BadRequestError for blank content');
        } catch (BadRequestError) {
        }
    }

    public function testCreatePostTrimsContent(): void
    {
        $service = new FeedService(new FakeRepo());
        $post = $service->createPost(1, '  hi there  ');
        $this->assertSame('hi there', $post->content);
        $this->assertSame(0, $post->likeCount);
    }
}

final class FakeRepo implements FeedRepository
{
    private const ALICE = 1;
    private const A_POST = 10;

    private int $likeCalls = 0;

    public function findUserById(int $id): ?User
    {
        return $id === self::ALICE ? new User(1, 'user_000001', 'Alice') : null;
    }

    public function feed(): array
    {
        return [$this->post()];
    }

    public function findPostById(int $id): ?Post
    {
        return $id === self::A_POST ? $this->post() : null;
    }

    public function like(int $userId, int $postId): void
    {
        $this->likeCalls++;
    }

    public function createPost(int $userId, string $content): Post
    {
        return new Post(99, $userId, 'user_000001', 'Alice', $content, new \DateTimeImmutable('2026-07-01T13:00:00+00:00'), 0);
    }

    private function post(): Post
    {
        return new Post(10, 1, 'user_000001', 'Alice', 'hello hexagon', new \DateTimeImmutable('2026-07-01T12:00:00+00:00'), 2);
    }
}