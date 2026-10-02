package dev.bench.domain.workflows;

import dev.bench.domain.errors.BadRequestError;
import dev.bench.domain.errors.NotFoundError;
import dev.bench.domain.models.Post;
import dev.bench.domain.models.User;
import dev.bench.domain.ports.FeedRepository;

import java.util.List;

/**
 * FeedService — pure application workflow. Each operation validates its inputs
 * first (pure helpers), then drives the {@link FeedRepository} port.
 *
 * No framework imports, no I/O types: never touches HTTP, JDBC or Spring.
 *
 * Reflects the contract in docs/../infra/api-contract.md:
 *  - GET  /api/me            → getMe(userId)
 *  - GET  /api/feed          → getFeed(actingUser)
 *  - GET  /api/posts/{id}    → getPost(actingUser, rawId)
 *  - POST /api/posts/{id}/like → likePost(actingUser, rawId)
 *  - POST /api/posts         → createPost(actingUser, rawContent)
 */
public class FeedService {

    private final FeedRepository repo;

    /** Composition root wires the port implementation into the workflow. */
    public FeedService(FeedRepository repo) {
        this.repo = repo;
    }

    /**
     * Parse and validate a positive integer id. Pure.
     * Non-numeric / non-positive → {@link BadRequestError} (adapter maps to 400).
     */
    public static long parseId(String raw) {
        if (raw == null || raw.isEmpty()) {
            throw new BadRequestError("bad request");
        }
        try {
            long value = Long.parseLong(raw);
            if (value <= 0) {
                throw new BadRequestError("bad request");
            }
            return value;
        } catch (NumberFormatException e) {
            throw new BadRequestError("bad request");
        }
    }

    /**
     * Validate post content. Pure. Returns trimmed content or throws
     * {@link BadRequestError} (adapter maps to 400).
     */
    public static String validateContent(String raw) {
        String content = raw == null ? "" : raw.trim();
        if (content.isEmpty()) {
            throw new BadRequestError("content required");
        }
        return content;
    }

    /** GET /api/me → the acting user, or {@link NotFoundError} when unknown. */
    public User getMe(long userId) {
        return repo.findByUserId(userId)
                .orElseThrow(() -> new NotFoundError("not found"));
    }

    /** GET /api/feed → the 20 newest posts. Acting user is not needed. */
    public List<Post> getFeed(long actingUser) {
        return repo.feed();
    }

    /** GET /api/posts/{id} → 400 on bad id, 404 when unknown, else the post. */
    public Post getPost(long actingUser, String rawId) {
        long id = parseId(rawId);
        return repo.findPostById(id)
                .orElseThrow(() -> new NotFoundError("not found"));
    }

    /** POST /api/posts/{id}/like → idempotent; 400 bad id, 404 when unknown. */
    public void likePost(long actingUser, String rawId) {
        long id = parseId(rawId);
        Post post = repo.findPostById(id)
                .orElseThrow(() -> new NotFoundError("not found"));
        repo.like(actingUser, id);
    }

    /** POST /api/posts → validates content, then persists; 400 for blank content. */
    public Post createPost(long actingUser, String rawContent) {
        String content = validateContent(rawContent);
        return repo.createPost(actingUser, content);
    }
}