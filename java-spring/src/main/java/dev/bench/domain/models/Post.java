package dev.bench.domain.models;

import java.time.OffsetDateTime;

/**
 * Domain model: a post with author snapshot and like count.
 *
 * Pure data — no framework, no JDBC. Part of the hexagon's core.
 */
public record Post(
        long id,
        long userId,
        String username,
        String displayName,
        String content,
        OffsetDateTime postedAt,
        long likeCount) {
}