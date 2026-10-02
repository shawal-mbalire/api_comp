namespace Apicomp.Domain;

// ─── Ports: contracts the domain needs fulfilled. The PostgreSQL adapter
//     (Adapters/PostgresFeedRepository.cs) and test fakes implement this
//     interface. See docs/../infra/api-contract.md for the raw SQL source of truth. ─

/// <summary>FeedRepository port — the data-access boundary of the domain.</summary>
public interface IFeedRepository
{
    /// <summary>SELECT id, username, display_name FROM users WHERE id = $1</summary>
    Task<User?> FindByUserIdAsync(long id, CancellationToken ct);

    /// <summary>The 20 newest posts (author + like count):
    /// ORDER BY posted_at DESC, id DESC LIMIT 20</summary>
    Task<IReadOnlyList<Post>> FeedAsync(CancellationToken ct);

    /// <summary>Single post with author + like count.</summary>
    Task<Post?> FindPostByIdAsync(long id, CancellationToken ct);

    /// <summary>INSERT INTO likes ... ON CONFLICT DO NOTHING (idempotent).</summary>
    Task LikeAsync(long userId, long postId, CancellationToken ct);

    /// <summary>INSERT INTO posts ... RETURNING id, posted_at; full post read back.</summary>
    Task<Post> CreatePostAsync(long userId, string content, CancellationToken ct);
}