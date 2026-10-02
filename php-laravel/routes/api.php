<?php

use App\Http\Controllers\ApiController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes — mounted under /api via bootstrap/app.php (withRouting(api: ...))
| using the framework's `api` middleware group (no CSRF / sessions / cookies).
|--------------------------------------------------------------------------
|
| Contract endpoints (docs/../infra/api-contract.md). Auth is the benchmark
| simplification `Authorization: Bearer <user_id>` handled in ApiController.
|
*/

Route::get('/me', [ApiController::class, 'me']);
Route::get('/feed', [ApiController::class, 'feed']);
Route::get('/posts/{id}', [ApiController::class, 'show']);
Route::post('/posts/{id}/like', [ApiController::class, 'like']);
Route::post('/posts', [ApiController::class, 'store']);