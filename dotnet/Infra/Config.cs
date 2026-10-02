namespace Apicomp.Infra;

// ─── Infrastructure: the ONLY place environment variables are read. The frozen
//     Config record is assembled once in the composition root and injected into
//     the adapters. No application logic here. ─

/// <summary>Typed runtime configuration. Immutable (record).</summary>
public sealed record Config(int Port, string DatabaseUrl, int PoolSize)
{
    /// <summary>Reads PORT / DATABASE_URL / POOL_SIZE from the environment with the
    /// contract defaults: port 5000, DATABASE_URL "postgres://app:app@db:5432/app",
    /// pool exactly 10 per process.</summary>
    public static Config FromEnv()
    {
        var port = int.TryParse(Environment.GetEnvironmentVariable("PORT"), out var p) && p > 0
            ? p
            : 5000;

        var databaseUrl = Environment.GetEnvironmentVariable("DATABASE_URL")
                          ?? "postgres://app:app@db:5432/app";

        var poolSize = int.TryParse(Environment.GetEnvironmentVariable("POOL_SIZE"), out var ps) && ps > 0
            ? ps
            : 10;

        return new Config(port, databaseUrl, poolSize);
    }
}