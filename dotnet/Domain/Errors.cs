namespace Apicomp.Domain;

// ─── Domain errors: business-rule failures the HTTP adapter maps to status codes ─

/// <summary>Invalid id / missing content → driving adapter returns 400.</summary>
public class BadRequestException : Exception
{
    public string Code { get; } = "BAD_REQUEST";

    public BadRequestException(string message) : base(message) { }
}

/// <summary>Unknown resource → driving adapter returns 404.</summary>
public class NotFoundException : Exception
{
    public string Code { get; } = "NOT_FOUND";

    public NotFoundException(string message) : base(message) { }
}