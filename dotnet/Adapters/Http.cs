using System.Text.Json;
using System.Text.Json.Serialization;
using Apicomp.Domain;

namespace Apicomp.Adapters;

// ─── Driving adapter: ASP.NET Core Minimal API HTTP surface. Translates wire
//     formats (authorization header, JSON bodies, path params) into domain calls via
//     the FeedService, and maps domain results/errors → HTTP DTOs. No SQL and no
//     business rules here (rules live in Domain/Workflows.cs). ─

public static class ApiEndpoints
{
    /// <summary>Maps the contract endpoints onto the application. Call from the
    /// composition root (Program.cs) after wiring the FeedService.</summary>
    public static void MapApiEndpoints(this WebApplication app, FeedService service)
    {
        app.MapGet("/health", () => Results.Json(new { status = "ok" }));

        app.MapGet("/api/me", async (HttpContext ctx, CancellationToken ct) =>
        {
            if (!TryGetUserId(ctx, out var userId))
                return Results.Json(new { error = "unauthorized" }, statusCode: 401);
            try
            {
                var user = await service.GetMeAsync(userId, ct);
                return Results.Json(new UserDto(user.Id, user.Username, user.DisplayName));
            }
            catch (Exception e)
            {
                return HandleDomainError(e);
            }
        });

        app.MapGet("/api/feed", async (HttpContext ctx, CancellationToken ct) =>
        {
            if (!TryGetUserId(ctx, out _))
                return Results.Json(new { error = "unauthorized" }, statusCode: 401);
            try
            {
                var posts = await service.GetFeedAsync(ct); // acting user not needed for the global feed
                return Results.Ok(posts.Select(ToPostDto).ToArray());
            }
            catch (Exception e)
            {
                return HandleDomainError(e);
            }
        });

        app.MapGet("/api/posts/{id}", async (string id, HttpContext ctx, CancellationToken ct) =>
        {
            if (!TryGetUserId(ctx, out _))
                return Results.Json(new { error = "unauthorized" }, statusCode: 401);
            try
            {
                var post = await service.GetPostAsync(0, id, ct); // acting user unused by this workflow
                return Results.Json(ToPostDto(post));
            }
            catch (Exception e)
            {
                return HandleDomainError(e);
            }
        });

        app.MapPost("/api/posts/{id}/like", async (string id, HttpContext ctx, CancellationToken ct) =>
        {
            if (!TryGetUserId(ctx, out var userId))
                return Results.Json(new { error = "unauthorized" }, statusCode: 401);
            try
            {
                await service.LikePostAsync(userId, id, ct);
                return Results.NoContent(); // 204 No Content
            }
            catch (Exception e)
            {
                return HandleDomainError(e);
            }
        });

        app.MapPost("/api/posts", async (HttpContext ctx, CancellationToken ct) =>
        {
            if (!TryGetUserId(ctx, out var userId))
                return Results.Json(new { error = "unauthorized" }, statusCode: 401);

            CreatePostRequest? body;
            try
            {
                body = await ctx.Request.ReadFromJsonAsync<CreatePostRequest>(cancellationToken: ct);
            }
            catch (JsonException)
            {
                return Results.Json(new { error = "bad request" }, statusCode: 400);
            }

            try
            {
                var created = await service.CreatePostAsync(userId, body?.Content, ct);
                return Results.Created($"/api/posts/{created.Id}", ToPostDto(created)); // 201
            }
            catch (Exception e)
            {
                return HandleDomainError(e);
            }
        });
    }

    /// <summary>Map domain errors to HTTP; anything else is a 500 (adapter boundary).</summary>
    private static IResult HandleDomainError(Exception e)
    {
        if (e is BadRequestException)
            return Results.Json(new { error = "bad request" }, statusCode: 400);
        if (e is NotFoundException)
            return Results.Json(new { error = "not found" }, statusCode: 404);
        return Results.Json(new { error = "internal error" }, statusCode: 500);
    }

    /// <summary>Post → contract camelCase DTO; postedAt rendered ISO-8601 UTC
    /// (round-trip "O": e.g. 2026-07-01T12:00:00.0000000Z).</summary>
    private static PostDto ToPostDto(Post p) => new(
        p.Id,
        p.UserId,
        p.Username,
        p.DisplayName,
        p.Content,
        p.PostedAtUtc.ToString("O"),
        p.LikeCount);

    /// <summary>Benchmark simplification: `Authorization: Bearer <user_id>` — the bearer
    /// token IS the numeric acting user id. Missing/malformed → 401 at this boundary.</summary>
    private static bool TryGetUserId(HttpContext ctx, out long userId)
    {
        userId = 0;
        var header = ctx.Request.Headers.Authorization.ToString().Trim();
        if (string.IsNullOrEmpty(header))
            return false;

        const string prefix = "Bearer ";
        if (!header.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            return false;

        var token = header[prefix.Length..].Trim();
        return long.TryParse(token, out userId) && userId > 0;
    }

    // Wire DTOs — serialized with the framework's camelCase policy.
    private sealed record UserDto(long Id, string Username, string DisplayName);

    private sealed record PostDto(
        long Id,
        long UserId,
        string Username,
        string DisplayName,
        string Content,
        string PostedAt,
        long LikeCount);

    /// <summary>Wire DTO for POST /api/posts bodies.</summary>
    public sealed class CreatePostRequest
    {
        [JsonPropertyName("content")]
        public string? Content { get; set; }
    }
}