<?php
/**
 * The shop demo (examples/shop) on this host, beside the basic page:
 *
 * - a same-origin proxy for what the browser asks the shop for (`/index.js`,
 *   `/droplets/*`, `/assets/*`, `/api/*`), so its cookies are first-party
 *   and nothing is cross-origin;
 * - five pages (`/gallery`, `/product/<slug>`, `/cart`, `/login`, `/admin`)
 *   that fetch the shop's fragments on the server, all at once, and compose
 *   them in one layout.
 *
 * The contract they follow is examples/shop/CONTRACT.md.
 */

declare(strict_types=1);

require_once __DIR__ . '/http.php';

/** The stack this host is, in the footer: the one thing that differs between hosts. */
const SHOP_STACK = 'PHP 8.3';

/** What the browser's request may tell the shop; nothing that names a host, nothing per hop. `cookie` goes on filtered. */
const SHOP_REQUEST_HEADERS = [
    'accept',
    'accept-language',
    'content-type',
    'if-none-match',
    'origin',
    'referer',
    'user-agent',
    'x-droplet-props',
    'x-droplets-build',
];

/**
 * Per hop (RFC 9110 §7.6.1), no longer true once curl has decoded the body,
 * or set apart (`set-cookie`, which may come more than once).
 */
const SHOP_DROPPED_RESPONSE_HEADERS = [
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'proxy-connection',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'content-encoding',
    'content-length',
    'set-cookie',
];

/** The shop's own cookies, the only ones it is sent: another app's on this origin stay here. */
const SHOP_COOKIES = ['cart_id', 'shop_admin'];

/** How this process reaches the shop (`http://shop:8300` in Docker). */
function shop_internal_url(): string
{
    return rtrim(getenv('SHOP_INTERNAL_URL') ?: 'http://localhost:8300', '/');
}

/**
 * This host's own public origin. It goes out as `x-droplet-location` on every
 * request to the shop, written out in the environment: never the client's
 * Host.
 */
function shop_origin(): string
{
    $url = parse_url(getenv('SHOP_PUBLIC_URL') ?: 'http://localhost:8009');
    $port = isset($url['port']) ? ':' . $url['port'] : '';
    return ($url['scheme'] ?? 'http') . '://' . ($url['host'] ?? 'localhost') . $port;
}

/** The request's path and query exactly as the browser sent them. */
function shop_raw_target(): string
{
    return (string) ($_SERVER['REQUEST_URI'] ?? '/');
}

/** The browser's request header `$name`, or null. */
function shop_request_header(string $name): ?string
{
    $key = strtoupper(str_replace('-', '_', $name));
    $value = $_SERVER['HTTP_' . $key] ?? ($key === 'CONTENT_TYPE' ? ($_SERVER['CONTENT_TYPE'] ?? null) : null);
    return is_string($value) && $value !== '' ? $value : null;
}

/** The browser's `Cookie` header with the shop's cookies only, or null. */
function shop_cookie_header(): ?string
{
    $kept = [];
    foreach (explode(';', (string) shop_request_header('cookie')) as $pair) {
        if (in_array(trim(explode('=', $pair, 2)[0]), SHOP_COOKIES, true)) {
            $kept[] = trim($pair);
        }
    }
    return $kept === [] ? null : implode('; ', $kept);
}

/** Whether `$path` has a `.` or `..` segment once decoded: never a shop route. */
function shop_has_dot_segment(string $path): bool
{
    foreach (explode('/', $path) as $segment) {
        if (in_array(rawurldecode($segment), ['.', '..'], true)) {
            return true;
        }
    }
    return false;
}

/**
 * The page's query as `[key, value]` pairs, repeated keys kept and names
 * untouched (`$_GET` would merge `a=1&a=2` and turn `a.b` into `a_b`).
 */
function shop_query(): array
{
    $pairs = [];
    $raw = (string) ($_SERVER['QUERY_STRING'] ?? '');
    foreach ($raw === '' ? [] : explode('&', $raw) as $piece) {
        if ($piece === '') {
            continue;
        }
        [$key, $value] = array_pad(explode('=', $piece, 2), 2, '');
        $pairs[] = [urldecode($key), urldecode($value)];
    }
    return $pairs;
}

/** The page's query parameters named in `$keys`, in that order. */
function shop_pick(array $keys): array
{
    $query = shop_query();
    $picked = [];
    foreach ($keys as $key) {
        foreach ($query as $pair) {
            if ($pair[0] === $key) {
                $picked[] = $pair;
            }
        }
    }
    return $picked;
}

/** `[key, value]` pairs → a query string, every piece encoded. */
function shop_build_query(array $pairs): string
{
    return implode('&', array_map(static fn(array $pair) => rawurlencode($pair[0]) . '=' . rawurlencode($pair[1]), $pairs));
}

/** Untouched: the shop never sets Domain, so they belong to this origin. */
function shop_send_cookies(array $cookies): void
{
    foreach ($cookies as $cookie) {
        header('Set-Cookie: ' . $cookie, false);
    }
}

// ---- The proxy ----------------------------------------------------------------

/** Whether `$path` is one the browser asks the shop for. */
function shop_is_proxied(string $path): bool
{
    return preg_match('#^/(?:index\.js$|env\.js$|index\.css$|(?:droplets|assets|api)/)#', $path) === 1;
}

/**
 * Passes the browser's request on to the shop and its answer back: status,
 * headers less the per-hop ones, every `Set-Cookie`, a redirect as it is.
 * The body goes on as the browser sent it (`php://input`, which holds
 * multipart posts too: `enable_post_data_reading` is off, see php.ini).
 */
function shop_proxy(): void
{
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    $headers = ['x-droplet-location' => shop_origin()];
    foreach (SHOP_REQUEST_HEADERS as $name) {
        $value = shop_request_header($name);
        if ($value !== null) {
            $headers[$name] = $value;
        }
    }
    $cookie = shop_cookie_header();
    if ($cookie !== null) {
        $headers['cookie'] = $cookie;
    }
    $body = $method === 'GET' || $method === 'HEAD' ? null : (string) file_get_contents('php://input');

    // Concatenated, not resolved: a path like `//elsewhere` stays a path on the shop.
    $response = http_one(['method' => $method, 'url' => shop_internal_url() . shop_raw_target(), 'headers' => $headers, 'body' => $body], 15);
    if ($response['status'] === 0) {
        http_response_code(502);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'The shop is unreachable.';
        return;
    }

    http_response_code($response['status']);
    // And whatever the shop's `Connection` names as per hop.
    $dropped = SHOP_DROPPED_RESPONSE_HEADERS;
    foreach ($response['headers']['connection'] ?? [] as $value) {
        foreach (explode(',', $value) as $name) {
            $dropped[] = strtolower(trim($name));
        }
    }
    foreach ($response['headers'] as $name => $values) {
        if (!in_array($name, $dropped, true)) {
            foreach ($values as $index => $value) {
                header($name . ': ' . $value, $index === 0);
            }
        }
    }
    shop_send_cookies($response['headers']['set-cookie'] ?? []);
    if ($method !== 'HEAD') {
        echo $response['body'];
    }
}

// ---- Fragments ------------------------------------------------------------------

/**
 * `GET /droplets/<id>?<pairs>` for each of `$wanted` (`[id, pairs]`), in
 * parallel, as the browser's request: its cookies, this page as the host.
 * Each answer: `html`, `status`, `location`, `cookies`, `link`. Only an HTML
 * answer is a fragment (a 500 carries the droplet's error page); anything
 * else may echo the props, so it is never inserted.
 */
function shop_fragments(array $wanted): array
{
    $headers = ['accept' => 'text/html', 'x-droplet-location' => shop_origin(), 'referer' => shop_origin() . shop_raw_target()];
    $cookie = shop_cookie_header();
    if ($cookie !== null) {
        $headers['cookie'] = $cookie;
    }
    $requests = [];
    foreach ($wanted as $key => [$id, $pairs]) {
        $requests[$key] = ['url' => shop_internal_url() . '/droplets/' . rawurlencode($id) . '?' . shop_build_query($pairs), 'headers' => $headers];
    }
    $responses = http_all($requests);

    $results = [];
    foreach ($wanted as $key => [$id]) {
        $response = $responses[$key];
        $status = $response['status'] ?: 502;
        $result = [
            'html' => '',
            'status' => $status,
            'location' => null,
            'cookies' => $response['headers']['set-cookie'] ?? [],
            'link' => http_header($response, 'link'),
        ];
        $is_html = str_starts_with((string) http_header($response, 'content-type'), 'text/html');
        if ($status >= 300 && $status < 400) {
            $result['location'] = http_header($response, 'location');
        } elseif ((($status >= 200 && $status < 300) || $status === 500) && $is_html) {
            // Trusted markup from the shop: inserted as it is.
            $result['html'] = $response['body'];
            $results[$key] = $result;
            continue;
        }
        $reason = $status === 502 ? 'unreachable' : 'HTTP ' . $status;
        $result['html'] = sprintf('<p class="shop-unavailable">The %s droplet is unavailable (%s).</p>', h($id), h($reason));
        $results[$key] = $result;
    }
    return $results;
}

/** A product's name, category and id, from the product page's public `_data` read. */
function shop_product(string $slug): ?array
{
    $response = http_one([
        'url' => shop_internal_url() . '/droplets/product-page/_data?' . shop_build_query([['slug', $slug]]),
        'headers' => ['x-droplet-location' => shop_origin(), 'accept' => 'application/json'],
    ], 5);
    if ($response['status'] !== 200) {
        return null;
    }
    $body = json_decode($response['body'], true);
    $product = is_array($body) && is_array($body['data'] ?? null) ? ($body['data']['product'] ?? null) : null;
    return is_array($product) && is_string($product['id'] ?? null) && is_string($product['name'] ?? null) ? $product : null;
}

/** The fragments' `Link` preloads, as tags for the page's head: on this origin only. */
function shop_link_tags(array $results): string
{
    $origin = shop_origin();
    $tags = [];
    foreach ($results as $result) {
        foreach (preg_split('/,(?=\s*<)/', (string) $result['link']) as $part) {
            if (!preg_match('/^\s*<([^>]*)>(.*)$/s', $part, $match)) {
                continue;
            }
            $params = [];
            foreach (explode(';', $match[2]) as $param) {
                [$key, $value] = array_pad(array_map(static fn($piece) => trim($piece, " \t\""), explode('=', $param, 2)), 2, '');
                if ($key !== '' && $value !== '') {
                    $params[strtolower($key)] = $value;
                }
            }
            $rel = $params['rel'] ?? '';
            $href = $match[1];
            if (($rel !== 'preload' && $rel !== 'modulepreload') || !str_starts_with($href, $origin . '/')) {
                continue;
            }
            $as = isset($params['as']) ? sprintf(' as="%s"', h($params['as'])) : '';
            $tags[$href . ' ' . $rel] = sprintf('<link rel="%s" href="%s"%s>', h($rel), h($href), $as);
        }
    }
    return implode("\n", $tags);
}

/**
 * Fetches the toasts (first in the body), the header's cart and the page's fragments (all at
 * once), then answers: a droplet's redirect as it is, otherwise the page,
 * with every `Set-Cookie` the fragments sent.
 */
function shop_render(string $view, string $title, ?string $current, array $wanted = [], int $status = 200, array $vars = []): void
{
    $results = shop_fragments([['toast-center', []], ['shopping-cart', [['variant', 'badge']]], ...$wanted]);
    header('Cache-Control: private, no-store');
    shop_send_cookies(array_merge(...array_column($results, 'cookies')));
    foreach ($results as $result) {
        if ($result['location'] !== null) {
            header('Location: ' . $result['location'], true, $result['status']);
            return;
        }
    }

    $toasts = array_shift($results);
    $cart = array_shift($results);
    http_response_code($status);
    echo view('shop/layout', [
        'stack' => SHOP_STACK,
        'title' => $title,
        'current' => $current,
        'links' => shop_link_tags([$toasts, $cart, ...$results]),
        'toasts' => $toasts['html'],
        'cart' => $cart['html'],
        'content' => view('shop/' . $view, ['stack' => SHOP_STACK, 'fragments' => array_column($results, 'html'), ...$vars]),
    ]);
}

// ---- Pages ----------------------------------------------------------------------

/** Answers `$path` when it is the shop's, and says whether it was. */
function shop_route(string $path): bool
{
    if (shop_is_proxied($path)) {
        if (shop_has_dot_segment($path)) {
            http_response_code(400);
            header('Content-Type: text/plain; charset=utf-8');
            echo 'Bad request.';
            return true;
        }
        shop_proxy();
        return true;
    }
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method !== 'GET' && $method !== 'HEAD') {
        return false;
    }

    if ($path === '/gallery') {
        // The whole query to both: the shop drops what a droplet does not take.
        $query = shop_query();
        shop_render('gallery', 'Gallery', '/gallery', [['product-filter', $query], ['product-library', $query]]);
    } elseif (preg_match('#^/product/([^/]+)$#', $path, $match)) {
        $product = shop_product(rawurldecode($match[1]));
        if ($product === null) {
            shop_render('not-found', 'Not found', null, [], 404);
            return true;
        }
        $comments = [...shop_pick(['order', 'page', 'showing']), ['productId', $product['id']]];
        // `v`, when the link had one: the shop serves its build's page for the
        // current version and redirects an old one to this URL without it.
        $page = [['slug', (string) ($product['slug'] ?? '')], ...shop_pick(['v'])];
        shop_render('product', $product['name'], null, [['product-page', $page], ['product-comments', $comments]], 200, [
            'product' => $product,
            'category' => is_array($product['category'] ?? null) ? $product['category'] : [],
        ]);
    } elseif ($path === '/cart') {
        shop_render('cart', 'Cart', null, [['shopping-cart', [['variant', 'inline']]]]);
    } elseif ($path === '/login') {
        shop_render('login', 'Log in', null, [['login', shop_pick(['next'])]]);
    } elseif ($path === '/admin') {
        shop_render('admin', 'Admin', '/admin', [['product-admin', shop_pick(['view', 'id'])]]);
    } else {
        return false;
    }
    return true;
}
