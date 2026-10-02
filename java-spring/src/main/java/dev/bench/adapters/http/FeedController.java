package dev.bench.adapters.http;

import dev.bench.domain.workflows.FeedService;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Driving adapter: the HTTP surface of the hexagon.
 *
 * Translates wire formats (Authorization header, JSON bodies, path params) into
 * domain calls via {@link FeedService}, and maps domain results → camelCase JSON
 * DTOs. No SQL here, no business rules — rules live in
 * {@code domain.workflows.FeedService}; domain errors are mapped to HTTP statuses
 * by {@link FeedExceptionHandler}.
 *
 * Contract summary (infra/api-contract.md): all /api/* routes require auth (the
 * bearer token IS the acting user id); /health is public.
 */
@RestController
public class FeedController {

    /** Strict bearer rule: exactly {@code Bearer <positive integer>}. */
    private static final Pattern BEARER = Pattern.compile("^Bearer (\\d+)$");

    private final FeedService service;

    public FeedController(FeedService service) {
        this.service = service;
    }

    // ------------------------------------------------------------------ health

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok");
    }

    // ------------------------------------------------------------------ me

    @GetMapping("/api/me")
    public ResponseEntity<?> me(HttpServletRequest req) {
        Long actingUser = actingUser(req);
        if (actingUser == null) {
            return unauthorized();
        }
        return ResponseEntity.ok(UserDto.from(service.getMe(actingUser)));
    }

    // ------------------------------------------------------------------ feed

    @GetMapping("/api/feed")
    public ResponseEntity<?> feed(HttpServletRequest req) {
        Long actingUser = actingUser(req);
        if (actingUser == null) {
            return unauthorized();
        }
        List<PostDto> posts = service.getFeed(actingUser).stream().map(PostDto::from).toList();
        return ResponseEntity.ok(posts);
    }

    // ------------------------------------------------------------- single post

    @GetMapping("/api/posts/{id}")
    public ResponseEntity<?> getPost(@PathVariable String id, HttpServletRequest req) {
        Long actingUser = actingUser(req);
        if (actingUser == null) {
            return unauthorized();
        }
        return ResponseEntity.ok(PostDto.from(service.getPost(actingUser, id)));
    }

    // ------------------------------------------------------------------ like

    @PostMapping("/api/posts/{id}/like")
    public ResponseEntity<?> likePost(@PathVariable String id, HttpServletRequest req) {
        Long actingUser = actingUser(req);
        if (actingUser == null) {
            return unauthorized();
        }
        service.likePost(actingUser, id); // BadRequest/NotFound → advice → 400/404
        return ResponseEntity.noContent().build();
    }

    // ------------------------------------------------------------- create post

    @PostMapping("/api/posts")
    public ResponseEntity<?> createPost(@RequestBody(required = false) Map<String, Object> body,
                                        HttpServletRequest req) {
        Long actingUser = actingUser(req);
        if (actingUser == null) {
            return unauthorized();
        }
        String content = contentOf(body);
        PostDto created = PostDto.from(service.createPost(actingUser, content));
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    // ------------------------------------------------------------------ helpers

    /**
     * Extract the raw {@code content} field from the request body. A missing body
     * or a non-string field yields {@code null} → the domain answers 400.
     */
    private static String contentOf(Map<String, Object> body) {
        if (body == null) {
            return null;
        }
        Object raw = body.get("content");
        return raw instanceof String s ? s : null;
    }

    /**
     * Benchmark simplification: {@code Authorization: Bearer <user_id>} — the
     * bearer token IS the numeric acting user id. Missing/malformed → {@code null}
     * (the adapter answers {@code 401}).
     *
     * <p>Strict parity with every other stack: a bare positive integer only.
     * {@code 0}, floats, hex, exponents, signs ({@code +7}) and surrounding
     * whitespace are all malformed → {@code null}.
     */
    static Long parseBearer(String authHeader) {
        if (authHeader == null) {
            return null;
        }
        Matcher m = BEARER.matcher(authHeader);
        if (!m.matches()) {
            return null;
        }
        long value = Long.parseLong(m.group(1));
        return value > 0 ? value : null;
    }

    private static Long actingUser(HttpServletRequest req) {
        return parseBearer(req.getHeader("Authorization"));
    }

    private static ResponseEntity<Map<String, String>> unauthorized() {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "unauthorized"));
    }
}