namespace Apicomp.Domain;

// ─── Domain workflows: pure orchestrators. Each method validates its inputs first
//     (pure helpers), then drives the FeedRepository port. No I/O, no frameworks. ─

/// <summary>FeedService — the application workflows over the <see cref="IFeedRepository"/>
/// port. Depends only on the port, never on adapters.</summary>
public sealed class FeedService
{
    private readonly IFeedRepository _repository;

    public FeedService(IFeedRepository repository) => _repository = repository;

    /// <summary>Parse and validate a positive integer id. Pure.</summary>
    /// <exception cref="BadRequestException">when <paramref name="raw"/> is not a positive integer.</exception>
    public static long ParseId(string raw)
    {
        if (!long.TryParse(raw, out var id) || id <= 0)
            throw new BadRequestException("bad request");
        return id;
    }

    /// <summary>Validate post content (required, non-empty). Pure. Returns the
    /// trimmed content so every stack persists trimmed input (parity with
    /// rust/java/node/go/python/php).</summary>
    /// <exception cref="BadRequestException">when <paramref name="raw"/> is null or blank.</exception>
    public static string ValidateContent(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            throw new BadRequestException("bad request");
        return raw.Trim();
    }

    /// <summary>GET /api/me — returns the acting user or NotFoundException.</summary>
    public async Task<User> GetMeAsync(long userId, CancellationToken ct)
    {
        var found = await _repository.FindByUserIdAsync(userId, ct);
        if (found is null) throw new NotFoundException("not found");
        return found;
    }

    /// <summary>GET /api/feed — the 20 newest posts.</summary>
    public Task<IReadOnlyList<Post>> GetFeedAsync(CancellationToken ct)
        => _repository.FeedAsync(ct);

    /// <summary>GET /api/posts/{id} — single post; 400 on bad id, 404 on unknown.</summary>
    public async Task<Post> GetPostAsync(long actingUserId, string rawId, CancellationToken ct)
    {
        var id = ParseId(rawId);
        var found = await _repository.FindPostByIdAsync(id, ct);
        if (found is null) throw new NotFoundException("not found");
        return found;
    }

    /// <summary>POST /api/posts/{id}/like — 204 on success, 404 when the post is missing.</summary>
    public async Task LikePostAsync(long actingUserId, string rawId, CancellationToken ct)
    {
        var id = ParseId(rawId);
        var post = await _repository.FindPostByIdAsync(id, ct);
        if (post is null) throw new NotFoundException("not found");
        await _repository.LikeAsync(actingUserId, id, ct);
    }

    /// <summary>POST /api/posts — validates content, then creates the post.</summary>
    public async Task<Post> CreatePostAsync(long actingUserId, string? rawContent, CancellationToken ct)
    {
        var content = ValidateContent(rawContent);
        return await _repository.CreatePostAsync(actingUserId, content, ct);
    }
}