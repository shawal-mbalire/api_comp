<?php

use App\Http\Controllers\ApiController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
|
| Only the contract's root-level health probe lives here. All /api/*
| endpoints are defined in routes/api.php (framework `api` middleware group).
|
*/

Route::get('/health', [ApiController::class, 'health']);