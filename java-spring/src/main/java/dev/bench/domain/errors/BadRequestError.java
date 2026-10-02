package dev.bench.domain.errors;

/**
 * Domain error: invalid id / missing-or-blank content.
 * The HTTP adapter maps this to {@code 400 {"error":"bad request"}}.
 */
public class BadRequestError extends RuntimeException {

    public static final String CODE = "BAD_REQUEST";

    public BadRequestError(String message) {
        super(message);
    }

    /** Machine-readable code for the adapter boundary. */
    public String code() {
        return CODE;
    }
}