package dev.bench.adapters.postgres;

import dev.bench.domain.errors.NotFoundError;
import dev.bench.domain.models.Post;
import dev.bench.domain.models.User;
import dev.bench.domain.ports.FeedRepository;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Driven adapter: PostgreSQL {@link FeedRepository}.
 *
 * Owns the raw SQL (verbatim from infra/api-contract.md, with the only permitted
 * placeholder adaptation for the driver, {@code $1} → {@code ?}) and maps rows →
 * domain models. Depends only on JdbcTemplate + the port contract; no app imports
 * beyond the domain. DB failure types are translated here, never leaked outward.
 */
@Repository
public class PostgresFeedRepository implements FeedRepository {

    // ---- contract SQL (raw, placeholder syntax adjusted for JdbcTemplate) ----
    private static final String POST_SELECT = """
            SELECT p.id, p.user_id, u.username, u.display_name, p.content, p.posted_at,
                   (SELECT count(*) FROM likes l WHERE l.post_id = p.id) AS like_count
            FROM posts p
            JOIN users u ON u.id = p.user_id""";

    private static final String ME_SQL =
            "SELECT id, username, display_name FROM users WHERE id = ?";

    private static final String LIKE_SQL =
            "INSERT INTO likes (user_id, post_id) VALUES (?, ?) ON CONFLICT DO NOTHING";

    private static final String CREATE_SQL =
            "INSERT INTO posts (user_id, content) VALUES (?, ?) RETURNING id, posted_at";

    private final JdbcTemplate jdbc;

    public PostgresFeedRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final RowMapper<Post> POST_MAPPER = (ResultSet rs, int rowNum) -> {
        OffsetDateTime postedAt = rs.getTimestamp("posted_at").toInstant().atOffset(ZoneOffset.UTC);
        return new Post(
                rs.getLong("id"),
                rs.getLong("user_id"),
                rs.getString("username"),
                rs.getString("display_name"),
                rs.getString("content"),
                postedAt,
                rs.getLong("like_count"));
    };

    @Override
    public Optional<User> findByUserId(long userId) {
        try {
            User user = jdbc.queryForObject(ME_SQL,
                    (rs, rowNum) -> new User(
                            rs.getLong("id"),
                            rs.getString("username"),
                            rs.getString("display_name")),
                    userId);
            return Optional.ofNullable(user);
        } catch (EmptyResultDataAccessException e) {
            return Optional.empty();
        }
    }

    @Override
    public List<Post> feed() {
        return jdbc.query(POST_SELECT + " ORDER BY p.posted_at DESC, p.id DESC LIMIT 20", POST_MAPPER);
    }

    @Override
    public Optional<Post> findPostById(long postId) {
        try {
            Post post = jdbc.queryForObject(POST_SELECT + " WHERE p.id = ?", POST_MAPPER, postId);
            return Optional.ofNullable(post);
        } catch (EmptyResultDataAccessException e) {
            return Optional.empty();
        }
    }

    /**
     * Is this a Postgres foreign-key violation (SQLSTATE 23503)? The repo-wide
     * parity decision maps acting-user FK failures on like/create to 404; any
     * other integrity error must propagate as a 500, not be swallowed.
     */
    private static boolean isForeignKeyViolation(DataIntegrityViolationException e) {
        Throwable cause = e.getMostSpecificCause();
        return cause instanceof SQLException se && "23503".equals(se.getSQLState());
    }

    @Override
    public void like(long userId, long postId) {
        try {
            jdbc.update(LIKE_SQL, userId, postId);
        } catch (DataIntegrityViolationException e) {
            // Acting user id does not exist → FK violation → 404 (parity).
            if (isForeignKeyViolation(e)) {
                throw new NotFoundError("not found");
            }
            throw e;
        }
    }

    @Override
    public Post createPost(long userId, String content) {
        try {
            Map<String, Object> returned = jdbc.queryForMap(CREATE_SQL, userId, content);
            long newId = ((Number) returned.get("id")).longValue();
            // Full post via the same select as the rest of the API: author
            // snapshot from the JOIN, likeCount 0 from the likes subquery.
            return findPostById(newId).orElseThrow(() -> new NotFoundError("not found"));
        } catch (DataIntegrityViolationException e) {
            // Acting user id does not exist → FK violation → 404 (parity).
            if (isForeignKeyViolation(e)) {
                throw new NotFoundError("not found");
            }
            throw e;
        }
    }
}