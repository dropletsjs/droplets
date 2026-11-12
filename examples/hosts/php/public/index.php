<?php
/**
 * Droplets embedded from plain PHP: no framework, no Composer, curl only.
 *
 * Apache sends every path that is not a file in public/ here
 * (`FallbackResource`, see apache.conf), and so does PHP's built-in server
 * with this file as its router. `/` is the basic page; the shop's
 * pages and its proxy are in app/shop.php.
 */

declare(strict_types=1);

require __DIR__ . '/../app/http.php';
require __DIR__ . '/../app/shop.php';

/** Server-to-server address of the Svelte example's droplets server (inside Docker: the service name). */
$droplets_internal = rtrim(getenv('DROPLETS_INTERNAL_URL') ?: 'http://localhost:8000', '/');
/** Browser-facing address, written onto every fragment. */
$droplets_public = rtrim(getenv('DROPLETS_PUBLIC_URL') ?: 'http://localhost:8000', '/');

$path = (string) parse_url(shop_raw_target(), PHP_URL_PATH);

// PHP's built-in server, with this file as its router: a file in public/
// (shop.css) is served as it is.
if (PHP_SAPI === 'cli-server' && $path !== '/' && is_file(__DIR__ . $path)) {
    return false;
}

if (shop_route($path)) {
    return;
}

if ($path === '/' && in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) {
    // The Svelte example's droplets (examples/frameworks/svelte), one per
    // mode, fetched at once.
    $who = isset($_GET['who']) && is_string($_GET['who']) ? $_GET['who'] : 'PHP';
    $ids = ['client', 'ssr-hydrate', 'ssr-nohydrate'];
    $responses = http_all(array_map(static fn(string $id) => [
        'url' => $droplets_internal . '/droplets/' . rawurlencode($id) . '?' . http_build_query(['who' => $who]),
        'headers' => ['accept' => 'text/html', 'x-droplet-location' => $droplets_public],
    ], $ids), 5);
    $fragments = [];
    foreach ($ids as $index => $id) {
        $response = $responses[$index];
        // Only an HTML answer is a fragment (a 500 carries the droplet's error
        // page); anything else may echo the props, so it is never pasted.
        $status = $response['status'];
        $is_html = str_starts_with((string) http_header($response, 'content-type'), 'text/html');
        $fragments[] = (($status >= 200 && $status < 300) || $status === 500) && $is_html
            ? $response['body'] // trusted markup from the droplets server; never escaped
            : sprintf('<p class="error">droplet "%s" unavailable: %s</p>', h($id), $status ? 'HTTP ' . $status : 'unreachable');
    }
    echo view('index', ['droplets_public' => $droplets_public, 'fragments' => $fragments]);
    return;
}

http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
echo 'Not found.';
