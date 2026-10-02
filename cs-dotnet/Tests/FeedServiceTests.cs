using Apicomp.Domain;
using Xunit;

namespace Apicomp.Tests;

// Unit tests for Domain/Workflows.cs (FeedService) using a fake in-memory
// FeedRepository — no database required. Run: dotnet test Tests/Apicomp.Tests.csproj

public class FeedServiceTests
{
    private static readonly User Alice = new(1, "user_000001", "Alice");

    private static readonly Post APost = new(
        10, 1, "user_000001", "Alice",
        "hello hexagon", new DateTime(2026, 7, 1, 12, 0, 0, DateTimeKind.Utc), 2);

    // ── fake FeedRepository (pure, in-memory implementation of the port) ───────
    private sealed class FakeFeedRepository : IFeedRepository
    {
        public Task<User?> FindByUserIdAsync(long id, CancellationToken ct)
            => Task.FromResult(id == Alice.Id ? Alice : null);

        public Task<IReadOnlyList<Post>> FeedAsync(CancellationToken ct)
            => Task.FromResult<IReadOnlyList<Post>>(new[] { APost });

        public Task<Post?> FindPostByIdAsync(long id, CancellationToken ct)
            => Task.FromResult(id == APost.Id ? APost : null);

        public Task LikeAsync(long userId, long postId, CancellationToken ct)
            => Task.CompletedTask;

        public Task<Post> CreatePostAsync(long userId, string content, CancellationToken ct)
            => Task.FromResult(new Post(99, userId, Alice.Username, Alice.DisplayName,
                content, new DateTime(2026, 7, 1, 13, 0, 0, DateTimeKind.Utc), 0));
    }

    private static FeedService NewService() => new(new FakeFeedRepository());

    // ── pure helpers ────────────────────────────────────────────────────────────
    [Fact]
    public void ParseId_AcceptsPositiveIntegersOnly()
    {
        Assert.Equal(7, FeedService.ParseId("7"));
        Assert.Throws<BadRequestException>(() => FeedService.ParseId("abc"));
        Assert.Throws<BadRequestException>(() => FeedService.ParseId("0"));
        Assert.Throws<BadRequestException>(() => FeedService.ParseId("-3"));
        Assert.Throws<BadRequestException>(() => FeedService.ParseId("1.5"));
    }

    [Fact]
    public void ValidateContent_RejectsBlank()
    {
        Assert.Equal("hi", FeedService.ValidateContent("hi"));
        Assert.Equal("hi", FeedService.ValidateContent("  hi  ")); // trimmed
        Assert.Throws<BadRequestException>(() => FeedService.ValidateContent("   "));
        Assert.Throws<BadRequestException>(() => FeedService.ValidateContent(""));
        Assert.Throws<BadRequestException>(() => FeedService.ValidateContent(null));
    }

    // ── workflows (fake repo) ───────────────────────────────────────────────────
    [Fact]
    public async Task GetMe_ReturnsUser_UnknownThrowsNotFound()
    {
        var svc = NewService();
        Assert.Equal(Alice.Id, (await svc.GetMeAsync(Alice.Id, default)).Id);
        await Assert.ThrowsAsync<NotFoundException>(() => svc.GetMeAsync(999, default));
    }

    [Fact]
    public async Task GetFeed_ReturnsPosts()
    {
        var feed = await NewService().GetFeedAsync(default);
        Assert.Single(feed);
        Assert.Equal(2, feed[0].LikeCount);
    }

    [Fact]
    public async Task GetPost_BadIdThrowsBadRequest()
    {
        var svc = NewService();
        await Assert.ThrowsAsync<BadRequestException>(() => svc.GetPostAsync(1, "nope", default));
        await Assert.ThrowsAsync<BadRequestException>(() => svc.GetPostAsync(1, "-1", default));
    }

    [Fact]
    public async Task GetPost_UnknownThrowsNotFound()
    {
        var svc = NewService();
        Assert.Equal(APost.Id, (await svc.GetPostAsync(1, "10", default)).Id);
        await Assert.ThrowsAsync<NotFoundException>(() => svc.GetPostAsync(1, "999", default));
    }

    [Fact]
    public async Task LikePost_IsIdempotent_UnknownThrowsNotFound()
    {
        var svc = NewService();
        await svc.LikePostAsync(1, "10", default); // no throw (ON CONFLICT DO NOTHING is idempotent by contract)
        await svc.LikePostAsync(1, "10", default);
        await Assert.ThrowsAsync<NotFoundException>(() => svc.LikePostAsync(1, "999", default));
        await Assert.ThrowsAsync<BadRequestException>(() => svc.LikePostAsync(1, "bad", default));
    }

    [Fact]
    public async Task CreatePost_ValidatesContentThenPersists()
    {
        var svc = NewService();
        var created = await svc.CreatePostAsync(Alice.Id, "first post", default);
        Assert.Equal("first post", created.Content);
        Assert.Equal(0, created.LikeCount);
        await Assert.ThrowsAsync<BadRequestException>(() => svc.CreatePostAsync(1, "  ", default));
        await Assert.ThrowsAsync<BadRequestException>(() => svc.CreatePostAsync(1, "", default));
    }
}