using Apicomp.Domain;
using Npgsql;

namespace Apicomp.Adapters;

// ─── Driven adapter: PostgreSQL FeedRepository. Owns the raw SQL (verbatim from
//     docs/../infra/api-contract.md) and maps rows → domain models. The only file that
//     touches Npgsql (besides the composition root handing it a data source). ─

/// <summary>PostgreSQL implementation of <see cref="IFeedRepository"/>.
/// Constructor-injected <see cref="NpgsqlDataSource"/> (pool capped to POOL_SIZE).</summary>
public sealed class PostgresFeedRepository : IFeedRepository
{
    // Raw shared SQL (identical across all 8 stacks).
    private static readonly string PostSelect =
        """
        SELECT p.id, p.user_id, u.username, u.display_name, p.content, p.posted_at,
               (SELECT count(*) FROM likes l WHERE l.post_id = p.id) AS like_count
        FROM posts p
        JOIN users u ON u.id = p.user_id
        """;

    private const string MeSql =
        "SELECT id, username, display_name FROM users WHERE id = $1;";

    private static readonly string FeedSql = PostSelect + " ORDER BY p.posted_at DESC, p.id DESC LIMIT 20;";

    private static readonly string SinglePostSql = PostSelect + " WHERE p.id = $1;";

    private const string LikeSql =
        "INSERT INTO likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;";

    private const string CreatePostSql =
        "INSERT INTO posts (user_id, content) VALUES ($1, $2) RETURNING id, posted_at;";

    private readonly NpgsqlDataSource _dataSource;

    public PostgresFeedRepository(NpgsqlDataSource dataSource) => _dataSource = dataSource;

    /// <summary>Composition-root helper: build the data source from the environment
    /// config, forcing the pool cap to POOL_SIZE (exactly 10 per process by contract).</summary>
    public static NpgsqlDataSource CreateDataSource(string databaseUrl, int poolSize)
    {
        // Npgsql accepts both the key/value format and the postgres:// URI format.
        NpgsqlConnectionStringBuilder connBuilder;
        try
        {
            connBuilder = new NpgsqlConnectionStringBuilder(databaseUrl);
        }
        catch (ArgumentException)
        {
            connBuilder = new NpgsqlConnectionStringBuilder(ParsePostgresUri(databaseUrl));
        }

        connBuilder.Pooling = true;
        connBuilder.MaxPoolSize = poolSize; // experiment hard cap: exactly POOL_SIZE per process
        return NpgsqlDataSource.Create(connBuilder.ConnectionString);
    }

    public async Task<User?> FindByUserIdAsync(long id, CancellationToken ct)
    {
        await using var conn = await _dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(MeSql, conn) { Parameters = { new() { Value = id } } };
        await using var r = await cmd.ExecuteReaderAsync(ct);

        if (!await r.ReadAsync(ct)) return null;
        return new User(r.GetInt64(0), r.GetString(1), r.GetString(2));
    }

    public async Task<IReadOnlyList<Post>> FeedAsync(CancellationToken ct)
    {
        await using var conn = await _dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(FeedSql, conn);
        await using var r = await cmd.ExecuteReaderAsync(ct);

        var posts = new List<Post>();
        while (await r.ReadAsync(ct))
            posts.Add(ReadPost(r));
        return posts;
    }

    public async Task<Post?> FindPostByIdAsync(long id, CancellationToken ct)
    {
        await using var conn = await _dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(SinglePostSql, conn) { Parameters = { new() { Value = id } } };
        await using var r = await cmd.ExecuteReaderAsync(ct);

        return await r.ReadAsync(ct) ? ReadPost(r) : null;
    }

    public async Task LikeAsync(long userId, long postId, CancellationToken ct)
    {
        await using var conn = await _dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(LikeSql, conn)
        {
            Parameters = { new() { Value = userId }, new() { Value = postId } }
        };

        try
        {
            await cmd.ExecuteNonQueryAsync(ct); // idempotent: ON CONFLICT DO NOTHING
        }
        catch (PostgresException ex) when (ex.SqlState == "23503") // FK: user/post does not exist
        {
            throw new NotFoundException("not found");
        }
    }

    public async Task<Post> CreatePostAsync(long userId, string content, CancellationToken ct)
    {
        await using var conn = await _dataSource.OpenConnectionAsync(ct);

        long newId;
        await using (var cmd = new NpgsqlCommand(CreatePostSql, conn)
        {
            Parameters = { new() { Value = userId }, new() { Value = content } }
        })
        {
            try
            {
                var result = await cmd.ExecuteScalarAsync(ct); // RETURNING id, posted_at → id
                newId = result is null ? 0L : (long)result;
            }
            catch (PostgresException ex) when (ex.SqlState == "23503") // FK: user does not exist
            {
                throw new NotFoundException("not found");
            }
        }

        // Read back the full created post (author snapshot + like count = 0).
        var created = await FindPostByIdAsync(newId, ct);
        return created ?? throw new NotFoundException("not found");
    }

    /// <summary>Maps one post row to the contract's domain Post model. posted_at is
    /// timestamptz; Npgsql returns DateTime (UTC) which we force to UTC kind.</summary>
    private static Post ReadPost(NpgsqlDataReader r) => new(
        r.GetInt64(0),                          // id
        r.GetInt64(1),                          // user_id
        r.GetString(2),                         // username
        r.GetString(3),                         // display_name
        r.GetString(4),                         // content
        DateTime.SpecifyKind(r.GetDateTime(5), DateTimeKind.Utc), // posted_at
        r.GetInt64(6));                         // like_count

    /// <summary>Fallback parser for postgres://user:pass@host:port/db-style DATABASE_URLs.</summary>
    private static string ParsePostgresUri(string uri)
    {
        var u = new Uri(uri);
        var username = u.UserInfo;
        var password = "";
        var at = username.IndexOf(':');
        if (at >= 0)
        {
            password = username[(at + 1)..];
            username = username[..at];
        }

        var b = new NpgsqlConnectionStringBuilder
        {
            Host = u.Host,
            Port = u.Port > 0 ? u.Port : 5432,
            Database = u.AbsolutePath.TrimStart('/'),
            Username = username,
            Password = password
        };
        return b.ConnectionString;
    }
}