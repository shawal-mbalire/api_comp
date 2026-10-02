package dev.bench.adapters.http;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Unit tests for the strict bearer parser (the repo-wide parity rule:
 * exactly {@code Bearer <positive integer>} — everything else is malformed).
 */
class FeedControllerTest {

    @Test
    void parseBearerAcceptsBarePositiveInteger() {
        assertEquals(7L, FeedController.parseBearer("Bearer 7"));
        assertEquals(7L, FeedController.parseBearer("Bearer 007")); // leading zeros ok
    }

    @Test
    void parseBearerRejectsMalformedTokens() {
        String[] bad = {
            null, "", "Bearer", "Bearer ", "Bearer 0", "Bearer -3", "Bearer 7.0",
            "Bearer 1e3", "Bearer 0x10", "Bearer +7", "Bearer 7 ", "Bearer  7",
            "bearer 7", "BEARER 7", "Bearer 7 apples",
        };
        for (String token : bad) {
            assertNull(FeedController.parseBearer(token), "should reject: " + token);
        }
    }
}