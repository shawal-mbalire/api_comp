namespace Apicomp.Domain;

// ─── Domain models: pure data records, zero framework imports, zero side effects ─

/// <summary>A user (author). <see cref="User.Id"/> is the acting-user id carried by the
/// bearer token.</summary>
public sealed record User(long Id, string Username, string DisplayName);

/// <summary>A post with its author snapshot and like count.</summary>
public sealed record Post(
    long Id,
    long UserId,
    string Username,
    string DisplayName,
    string Content,
    DateTime PostedAtUtc,
    long LikeCount);