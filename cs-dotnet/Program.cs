using Apicomp.Adapters;
using Apicomp.Domain;
using Apicomp.Infra;

// ─── Composition root ───────────────────────────────────────────────────────────
// Reads config (Infra) → wires the PostgreSQL driven adapter behind the
// FeedRepository port → wires the domain FeedService → maps the HTTP driving
// adapter → runs. No business logic here.

var config = Config.FromEnv();

// Driven adapter: PostgreSQL (raw contract SQL) behind the FeedRepository port,
// pool capped to POOL_SIZE (default/forced 10 per process).
var dataSource = PostgresFeedRepository.CreateDataSource(config.DatabaseUrl, config.PoolSize);
var repository = new PostgresFeedRepository(dataSource);

// Domain workflows — depend only on the port.
var service = new FeedService(repository);

// Driving adapter: Minimal API surface (auth header, DTO mapping, error mapping).
var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls($"http://0.0.0.0:{config.Port}");
var app = builder.Build();

app.MapApiEndpoints(service);

// Graceful shutdown: release the Npgsql data source when the host stops
// (SIGTERM/SIGINT) so no pooled connections are left behind.
app.Lifetime.ApplicationStopping.Register(() => dataSource.Dispose());

app.Run();