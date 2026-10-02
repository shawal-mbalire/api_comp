package dev.bench.domain.errors;

/**
 * Domain error: unknown resource (user or post).
 * The HTTP adapter maps this to {@code 404 {"error":"not found"}}.
 */
public class NotFoundError extends RuntimeException {

    public static final String CODE = "NOT_FOUND";

    public NotFoundError(String message) {
        super(message);
    }

    /** Machine-readable code for the adapter boundary. */
    public String code() {
        return CODE;
    }
}