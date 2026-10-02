<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

/*
|--------------------------------------------------------------------------
| Create The Application
|--------------------------------------------------------------------------
|
| The first thing we will do is create a new Laravel application instance
| which serves as the "glue" for all of the components of Laravel, and is
| the IoC container binding all of the various parts.
|
| API routes live in routes/api.php and use the framework's `api` middleware
| group (SubstituteBindings only) so the benchmark POST endpoints are free of
| CSRF / sessions / cookies. The root-level /health probe stays in
| routes/web.php.
|
| NOTE: the framework's automatic `health: '/up'` endpoint is deliberately
| NOT registered — it is a closure route, and keeping the route table free of
| closures guarantees `php artisan route:cache` succeeds in the image build.
|
*/

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // TrimStrings / ConvertEmptyStringsToNull would silently mutate the
        // `content` field (stripping whitespace, turning "" into null). Every
        // other stack stores the request body verbatim, so remove them for
        // byte-for-byte parity across the 8 backends.
        $middleware->remove([
            \Illuminate\Foundation\Http\Middleware\TrimStrings::class,
            \Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();