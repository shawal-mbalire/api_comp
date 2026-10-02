package dev.bench.adapters.http;

import dev.bench.domain.errors.BadRequestError;
import dev.bench.domain.errors.NotFoundError;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

/**
 * Maps domain errors to the contract's HTTP error shape:
 *   BadRequestError → 400 {"error":"bad request"}
 *   NotFoundError   → 404 {"error":"not found"}
 *   Unparseable JSON bodies → 400 {"error":"bad request"} (mirrors the legacy
 *   handler so malformed POST /api/posts bodies get the contract shape instead
 *   of Spring's default error body).
 *
 * This is the adapter boundary: the domain throws its own errors, never HTTP.
 */
@RestControllerAdvice
public class FeedExceptionHandler {

    @ExceptionHandler(BadRequestError.class)
    public ResponseEntity<Map<String, String>> badRequest(BadRequestError ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", "bad request"));
    }

    @ExceptionHandler(NotFoundError.class)
    public ResponseEntity<Map<String, String>> notFound(NotFoundError ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "not found"));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, String>> badJson(HttpMessageNotReadableException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", "bad request"));
    }
}