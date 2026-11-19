<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Middleware\ValidatePathEncoding;
use Illuminate\Http\Middleware\ValidatePostSize;
use Illuminate\Support\Facades\Route;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(using: function (): void {
        // Outside the `web` group: its cookie encryption would scramble the
        // shop's cookies both ways, and its CSRF check would refuse the shop's
        // own form posts on their way through the proxy.
        Route::group([], base_path('routes/web.php'));
    })
    ->withMiddleware(function (Middleware $middleware): void {
        // Nothing that reads the body before the route is chosen (TrimStrings
        // parses a JSON one), nor CORS answers of Laravel's own for `/api/*`:
        // the shop's are passed on as they come.
        $middleware->use([ValidatePathEncoding::class, ValidatePostSize::class]);
    })
    ->withExceptions()
    ->create();
