<?php

declare(strict_types=1);

namespace App\Providers;

use App\Adapters\PostgresFeedRepository;
use App\Domain\Ports\FeedRepository;
use App\Domain\Workflows\FeedService;
use Illuminate\Support\ServiceProvider;
use PDO;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Composition root: bind the FeedRepository port to its Postgres adapter
     * and the FeedService workflow (domain depends only on the port).
     */
    public function register(): void
    {
        $this->app->singleton(FeedRepository::class, PostgresFeedRepository::class);
        $this->app->singleton(FeedService::class, function ($app) {
            return new FeedService($app->make(FeedRepository::class));
        });
    }

    /**
     * Infrastructure config: translate DATABASE_URL into the pgsql connection
     * config.
     *
     * The benchmark harness only injects PORT / DATABASE_URL / POOL_SIZE (see
     * docker-compose.yml). Laravel's per-component DB_* variables (DB_HOST,
     * DB_PORT, DB_DATABASE, DB_USERNAME, DB_PASSWORD, DB_CONNECTION) are NOT
     * provided, so we parse DATABASE_URL here at boot, before any request
     * touches the database. Connections are created lazily on first use.
     *
     * Pool sizing matches the contract's "exactly POOL_SIZE (10) per process":
     * the FrankenPHP Caddyfile pins num_threads to 10 (see docker-compose.yml),
     * and each thread keeps one persistent PDO connection, so the container's
     * Postgres pool is bounded at 10 in steady state.
     */
    public function boot(): void
    {
        $default = 'postgres://app:app@db:5432/app';
        $parts = parse_url(env('DATABASE_URL', $default));
        if (! is_array($parts)) {
            $parts = [];
        }

        $host = $parts['host'] ?? 'db';
        $port = $parts['port'] ?? 5432;
        $database = ltrim($parts['path'] ?? '/app', '/');
        $username = $parts['user'] ?? 'app';
        $password = $parts['pass'] ?? 'app';

        config([
            'database.default' => 'pgsql',
            'database.connections.pgsql.host' => $host,
            'database.connections.pgsql.port' => (int) $port,
            'database.connections.pgsql.database' => $database,
            'database.connections.pgsql.username' => $username,
            'database.connections.pgsql.password' => $password,
            'database.connections.pgsql.timezone' => 'UTC',
            'database.connections.pgsql.options' => [
                PDO::ATTR_CASE => PDO::CASE_NATURAL,
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                // Native pdo_pgsql prepared statements: raw $1/$2 placeholders
                // in the contract SQL bind positionally, exactly like Laravel's
                // own Postgres grammar.
                PDO::ATTR_EMULATE_PREPARES => false,
                // One persistent connection per FrankenPHP thread (pool of 10).
                PDO::ATTR_PERSISTENT => true,
            ],
        ]);
    }
}