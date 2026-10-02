package dev.bench.adapters.http;

import dev.bench.domain.models.Post;

import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

/**
 * HTTP DTO for a post. camelCase serialization is automatic: Jackson uses the
 * record component names. {@code postedAt} is formatted as the contract's
 * ISO-8601 UTC string ({@code YYYY-MM-DDTHH:MM:SS.mmmZ}).
 */
public record PostDto(
        long id,
        long userId,
        String username,
        String displayName,
        String content,
        String postedAt,
        long likeCount) {

    private static final DateTimeFormatter TS_FORMAT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    /** Map the domain model to the wire shape. */
    public static PostDto from(Post post) {
        return new PostDto(
                post.id(),
                post.userId(),
                post.username(),
                post.displayName(),
                post.content(),
                TS_FORMAT.format(post.postedAt()),
                post.likeCount());
    }
}