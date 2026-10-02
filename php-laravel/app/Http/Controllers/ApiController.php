<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domain\Errors\BadRequestError;
use App\Domain\Errors\NotFoundError;
use App\Domain\Workflows\FeedService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Driving adapter: maps HTTP ⇄ the domain FeedService. Extracts the benchmark
 * auth (bearer token = acting user id), formats camelCase JSON DTOs, and maps
 * domain errors → HTTP statuses. No SQL and no business rules here.
 */
class ApiController
{
    public function __construct(private readonly FeedService $service)
    {
    }

    /** GET /health -> 200 {"status":"ok"} */
    public function health(): JsonResponse
    {
        return response()->json(['status' => 'ok']);
    }

    /** GET /api/me -> 200 user | 401 | 404 */
    public function me(Request $request): JsonResponse
    {
        $userId = $this->actingUserId($request);
        if ($userId === null) {
            return $this->error('unauthorized', 401);
        }

        try {
            $user = $this->service->getMe($userId);
        } catch (BadRequestError|NotFoundError $e) {
            return $this->mapDomainError($e);
        }

        return response()->json([
            'id' => $user->id,
            'username' => $user->username,
            'displayName' => $user->displayName,
        ]);
    }

    /** GET /api/feed -> 200 [post x20] | 401 */
    public function feed(Request $request): JsonResponse
    {
        $userId = $this->actingUserId($request);
        if ($userId === null) {
            return $this->error('unauthorized', 401);
        }

        try {
            return response()->json(array_map(
                fn ($p) => $this->formatPost($p),
                $this->service->getFeed($userId),
            ));
        } catch (BadRequestError|NotFoundError $e) {
            return $this->mapDomainError($e);
        }
    }

    /** GET /api/posts/{id} -> 200 post | 400 | 404 | 401 */
    public function show(Request $request, string $id): JsonResponse
    {
        $userId = $this->actingUserId($request);
        if ($userId === null) {
            return $this->error('unauthorized', 401);
        }

        try {
            return response()->json($this->formatPost($this->service->getPost($userId, $id)));
        } catch (BadRequestError|NotFoundError $e) {
            return $this->mapDomainError($e);
        }
    }

    /** POST /api/posts/{id}/like -> 204 (idempotent) | 400 | 404 | 401 */
    public function like(Request $request, string $id): JsonResponse
    {
        $userId = $this->actingUserId($request);
        if ($userId === null) {
            return $this->error('unauthorized', 401);
        }

        try {
            $this->service->likePost($userId, $id);
        } catch (BadRequestError|NotFoundError $e) {
            return $this->mapDomainError($e);
        }

        return response()->noContent();
    }

    /** POST /api/posts {content} -> 201 post | 400 | 401 */
    public function store(Request $request): JsonResponse
    {
        $userId = $this->actingUserId($request);
        if ($userId === null) {
            return $this->error('unauthorized', 401);
        }

        try {
            $post = $this->service->createPost($userId, $request->input('content'));

            return response()->json($this->formatPost($post), 201);
        } catch (BadRequestError|NotFoundError $e) {
            return $this->mapDomainError($e);
        }
    }

    // --------------------------------------------------------------- helpers

    /**
     * Benchmark auth: `Authorization: Bearer <user_id>` — the token IS the
     * acting user id. Returns null for missing/malformed headers.
     */
    private function actingUserId(Request $request): ?int
    {
        $header = $request->header('Authorization', '');
        if (preg_match('/^Bearer\s+([0-9]+)$/i', $header, $m) !== 1) {
            return null;
        }

        $userId = (int) $m[1];

        // A bare "0" is malformed per the contract (token IS a positive user id).
        return $userId > 0 ? $userId : null;
    }

    /** Map a domain Post to the camelCase contract JSON shape. */
    private function formatPost(\App\Domain\Models\Post $p): array
    {
        return [
            'id' => $p->id,
            'userId' => $p->userId,
            'username' => $p->username,
            'displayName' => $p->displayName,
            'content' => $p->content,
            // Deterministic UTC ISO-8601 with millisecond precision (.mmmZ).
            'postedAt' => $p->postedAt->format('Y-m-d\TH:i:s.v\Z'),
            'likeCount' => $p->likeCount,
        ];
    }

    private function mapDomainError(BadRequestError|NotFoundError $e): JsonResponse
    {
        if ($e instanceof BadRequestError) {
            return $this->error('bad request', 400);
        }

        return $this->error('not found', 404);
    }

    private function error(string $message, int $status): JsonResponse
    {
        return response()->json(['error' => $message], $status);
    }
}