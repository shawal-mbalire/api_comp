using Apicomp.Adapters;
using Xunit;

namespace Apicomp.Tests;

/// <summary>
/// Unit tests for the strict bearer parser (the repo-wide parity rule:
/// exactly <c>Bearer &lt;positive integer&gt;</c> — everything else is malformed).
/// Requires no ASP.NET host: the rule lives in the pure
/// <see cref="ApiEndpoints.TryParseBearer"/> helper.
/// </summary>
public class HttpAdapterTests
{
    [Theory]
    [InlineData("Bearer 7", 7L)]
    [InlineData("Bearer 007", 7L)] // leading zeros are fine
    public void TryParseBearerAcceptsBarePositiveInteger(string header, long expected)
    {
        var ok = ApiEndpoints.TryParseBearer(header, out var userId);
        Assert.True(ok);
        Assert.Equal(expected, userId);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Bearer")]
    [InlineData("Bearer ")]
    [InlineData("Bearer 0")]
    [InlineData("Bearer -3")]
    [InlineData("Bearer 7.0")]
    [InlineData("Bearer 1e3")]
    [InlineData("Bearer 0x10")]
    [InlineData("Bearer +7")]
    [InlineData("Bearer 7 ")]
    [InlineData("Bearer  7")]
    [InlineData("bearer 7")]
    [InlineData("BEARER 7")]
    public void TryParseBearerRejectsMalformedTokens(string header)
    {
        Assert.False(ApiEndpoints.TryParseBearer(header, out _));
    }
}