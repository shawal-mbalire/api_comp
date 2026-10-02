package dev.bench.domain.ports;

import dev.bench.domain.models.Post;
import dev.bench.domain.models.User;

import java.util.List;
import java.util.Optional;

/**
 * FeedRepository port — the data-access boundary of the hexagon.
 *
 * Implementations: {@code adapters.postgres.PostgresFeedRepository} (the
 * benchmark PostgreSQL adapter). A second implementation (e.g. SQLite, in-memory
 * for tests) can be dropped in without touching the domain workflow.
 *
 * Ports may never leak JDBC / DB types — only domain models and plain Java.
 */
public interface FeedRepository {

    /** "me": SELECT id, username, display_name FROM users WHERE id = ? */
    Optional<User> findByUserId(long userId);

    /** "feed": the 20 newest posts (author + like count), ORDER BY posted_at DESC, id DESC LIMIT 20. */
    List<Post> feed();

    /** Single post with author + like count. */
    Optional<Post> findPostById(long postId);

    /** Idempotent like: INSERT INTO likes ... ON CONFLICT DO NOTHING. */
    void like(long userId, long postId);

    /** Create a post; returns the full post (author snapshot, likeCount 0). */
    Post createPost(long userId, String content);
}