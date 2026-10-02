package dev.bench.domain.workflows;

import dev.bench.domain.errors.BadRequestError;
import dev.bench.domain.errors.NotFoundError;
import dev.bench.domain.models.Post;
import dev.bench.domain.models.User;
import dev.bench.domain.ports.FeedRepository;

import org.junit.jupiter.api.Test;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Unit tests for the domain workflow using a fake in-memory {@link FeedRepository}.
 *
 * Run: {@code mvn test} (JUnit 5, no Spring context, no database).
 */
class FeedServiceTest {

    private static final User ALICE = new User(1, "user_000001", "Alice");

    private static final Post A_POST = new Post(
            10, 1, "user_000001", "Alice", "hello hexagon",
            OffsetDateTime.of(2026, 7, 1, 12, 0, 0, 0, ZoneOffset.UTC), 2);

    private static FeedRepository fakeRepository() {
        return new FeedRepository() {
            @Override
            public Optional<User> findByUserId(long userId) {
                return userId == ALICE.id() ? Optional.of(ALICE) : Optional.empty();
            }

            @Override
            public List<Post> feed() {
                return List.of(A_POST);
            }

            @Override
            public Optional<Post> findPostById(long postId) {
                return postId == A_POST.id() ? Optional.of(A_POST) : Optional.empty();
            }

            @Override
            public void like(long userId, long postId) {
                // idempotent by contract (INSERT ... ON CONFLICT DO NOTHING)
            }

            @Override
            public Post createPost(long userId, String content) {
                return new Post(99, userId, ALICE.username(), ALICE.displayName(), content,
                        OffsetDateTime.of(2026, 7, 1, 13, 0, 0, 0, ZoneOffset.UTC), 0);
            }
        };
    }

    // ── pure helpers ─────────────────────────────────────────────────────────

    @Test
    void parseIdAcceptsPositiveIntegersOnly() {
        assertEquals(7, FeedService.parseId("7"));
        assertThrows(BadRequestError.class, () -> FeedService.parseId("abc"));
        assertThrows(BadRequestError.class, () -> FeedService.parseId("0"));
        assertThrows(BadRequestError.class, () -> FeedService.parseId("-3"));
        assertThrows(BadRequestError.class, () -> FeedService.parseId("1.5"));
        assertThrows(BadRequestError.class, () -> FeedService.parseId(""));
    }

    @Test
    void validateContentTrimsAndRejectsBlank() {
        assertEquals("hi", FeedService.validateContent("  hi  "));
        assertThrows(BadRequestError.class, () -> FeedService.validateContent("   "));
        assertThrows(BadRequestError.class, () -> FeedService.validateContent(""));
        assertThrows(BadRequestError.class, () -> FeedService.validateContent(null));
    }

    // ── workflows (fake repo) ────────────────────────────────────────────────

    @Test
    void getMeReturnsUserUnknownIdThrowsNotFound() {
        FeedService svc = new FeedService(fakeRepository());
        assertEquals(1L, svc.getMe(1).id());
        assertThrows(NotFoundError.class, () -> svc.getMe(999));
    }

    @Test
    void getFeedReturnsPosts() {
        FeedService svc = new FeedService(fakeRepository());
        List<Post> feed = svc.getFeed(1);
        assertEquals(1, feed.size());
        assertEquals(2, feed.get(0).likeCount());
    }

    @Test
    void getPostMapsBadIdAndUnknownPost() {
        FeedService svc = new FeedService(fakeRepository());
        assertEquals(10L, svc.getPost(1, "10").id());
        assertThrows(NotFoundError.class, () -> svc.getPost(1, "999"));
        assertThrows(BadRequestError.class, () -> svc.getPost(1, "nope"));
        assertThrows(BadRequestError.class, () -> svc.getPost(1, "0"));
    }

    @Test
    void likePostIsIdempotentUnknownPostThrowsNotFound() {
        FeedService svc = new FeedService(fakeRepository());
        assertDoesNotThrow(() -> svc.likePost(1, "10"));
        assertDoesNotThrow(() -> svc.likePost(1, "10")); // idempotent
        assertThrows(NotFoundError.class, () -> svc.likePost(1, "999"));
        assertThrows(BadRequestError.class, () -> svc.likePost(1, "bad"));
    }

    @Test
    void createPostValidatesThenPersists() {
        FeedService svc = new FeedService(fakeRepository());
        Post created = svc.createPost(1, "  first post ");
        assertEquals("first post", created.content());
        assertEquals(0, created.likeCount());
        assertThrows(BadRequestError.class, () -> svc.createPost(1, "  "));
        assertThrows(BadRequestError.class, () -> svc.createPost(1, ""));
    }
}