<?php

use Illuminate\Support\Facades\Artisan;

/*
|--------------------------------------------------------------------------
| Console Routes
|--------------------------------------------------------------------------
|
| This benchmark API defines no console commands. The file exists so the
| repository is fully self-contained: the runtime image is built from a
| `composer create-project` scaffold overlaid with this repo's files, and
| bootstrap/app.php wires `commands:` to this path. Keeping it here means
| the behavior never depends on scaffold leftovers.
|
| You may register `Artisan::command(...)` closures here if the app grows
| commands — note those are NOT HTTP routes, so `php artisan route:cache`
| (used in the image build) is unaffected.
|
*/

Artisan::command('benchmark:noop', function (): void {
    $this->info('api_comp php-laravel: no console commands defined.');
});