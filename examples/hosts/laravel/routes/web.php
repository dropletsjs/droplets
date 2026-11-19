<?php

use App\Http\Controllers\HomeController;
use App\Http\Controllers\ShopController;
use App\Http\Controllers\ShopProxyController;
use Illuminate\Support\Facades\Route;

// What the browser asks the shop for, every method, before any page route.
foreach (['/index.js', '/env.js', '/index.css'] as $file) {
    Route::any($file, ShopProxyController::class);
}
foreach (['droplets', 'assets', 'api'] as $prefix) {
    Route::any("/$prefix/{rest}", ShopProxyController::class)->where('rest', '.*');
}

Route::get('/', HomeController::class);

Route::get('/gallery', [ShopController::class, 'gallery']);
Route::get('/product/{slug}', [ShopController::class, 'product']);
Route::get('/cart', [ShopController::class, 'cart']);
Route::get('/login', [ShopController::class, 'login']);
Route::get('/admin', [ShopController::class, 'admin']);
