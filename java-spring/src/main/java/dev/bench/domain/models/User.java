package dev.bench.domain.models;

/**
 * Domain model: a user (author). {@code id} is the acting-user id that the
 * bearer token carries.
 *
 * Pure data — no framework, no JDBC. Part of the hexagon's core.
 */
public record User(long id, String username, String displayName) {
}