package dev.bench.adapters.http;

import dev.bench.domain.models.User;

/**
 * HTTP DTO for a user. camelCase serialization is automatic: Jackson uses the
 * record component names.
 */
public record UserDto(long id, String username, String displayName) {

    /** Map the domain model to the wire shape. */
    public static UserDto from(User user) {
        return new UserDto(user.id(), user.username(), user.displayName());
    }
}