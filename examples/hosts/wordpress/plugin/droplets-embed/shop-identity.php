<?php
/**
 * The WordPress account is the shop's only login (examples/wp-shop).
 *
 * WordPress → wp-shop: when a logged-in user who can `manage_options` causes
 * a request to wp-shop (a fragment fetched on the server, or a request the
 * proxy passes on under `/droplets/` or `/api/`), the plugin adds
 *
 *   x-wp-shop-user: base64url(JSON {sub, role, exp, method, path, aud}).base64url(HMAC-SHA256)
 *
 * keyed with WP_SHOP_HOST_SECRET: the user's login, `administrator`, an
 * expiry 60 seconds out, and the one request it is for (method, path and
 * query on wp-shop), `aud: "wp-shop"`. wp-shop's `handle` checks it.
 *
 * wp-shop → WordPress: its writes (stock and price) come back to the REST
 * API with `x-wp-shop-service`, the same format with `aud: "wordpress"`,
 * keyed with WP_SHOP_SERVICE_SECRET, a secret of its own: a leaked
 * `x-wp-shop-user` key does not sign writes, nor the other way round.
 * `determine_current_user` below runs such a request as that user, if the
 * user still can `manage_options`, and only for the routes in
 * DROPLETS_SHOP_SERVICE_ROUTES; on any other route the header is ignored
 * and WordPress's own login applies. WordPress's own checks still apply.
 *
 * Each secret is 32+ bytes; equal secrets are refused (both unset, logged).
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/** The header WordPress sends wp-shop, and the one wp-shop's writes carry. */
const DROPLETS_SHOP_USER_HEADER = 'x-wp-shop-user';
const DROPLETS_SHOP_SERVICE_HEADER = 'x-wp-shop-service';
const DROPLETS_SHOP_ASSERTION_SECONDS = 60;
const DROPLETS_SHOP_ASSERTION_MAX = 1024;

/**
 * What wp-shop's `x-wp-shop-service` may do, and nothing else: method, and
 * the whole request URI (path and query), anchored. `updateProduct` in
 * examples/wp-shop/src/lib/server/wp.ts: a product's stock and price, by
 * its numeric id, with `_fields` the only query parameter (no
 * `rest_route` or `_method` to send the request elsewhere). Its comments
 * are posted anonymously, without the header.
 */
const DROPLETS_SHOP_SERVICE_ROUTES = [
    ['POST', '#^/wp-json/wp/v2/products/[1-9][0-9]{0,9}(?:\?_fields=[a-z_,]{1,200})?$#D'],
];
/** The same writes as REST routes, checked again once WordPress has routed the request. */
const DROPLETS_SHOP_SERVICE_REST_ROUTES = [
    ['POST', '#^/wp/v2/products/[1-9][0-9]{0,9}$#D'],
];

/** `$name` from the environment when it is long enough (32+ bytes), else null. */
function droplets_shop_env_secret(string $name): ?string
{
    $secret = getenv($name);
    return is_string($secret) && strlen($secret) >= 32 ? $secret : null;
}

/**
 * Both secrets: `host` (WP_SHOP_HOST_SECRET, signs `x-wp-shop-user`) and
 * `service` (WP_SHOP_SERVICE_SECRET, checks `x-wp-shop-service`), each
 * null when unset or short. The same value for both is refused: neither
 * is used, and the log says why, once per request.
 *
 * @return array{host: ?string, service: ?string}
 */
function droplets_shop_secrets(): array
{
    static $secrets = null;
    if ($secrets !== null) {
        return $secrets;
    }
    $host = getenv('WP_SHOP_HOST_SECRET');
    $service = getenv('WP_SHOP_SERVICE_SECRET');
    if (is_string($host) && $host !== '' && is_string($service) && hash_equals($host, $service)) {
        error_log('[droplets-embed] WP_SHOP_HOST_SECRET and WP_SHOP_SERVICE_SECRET are the same value: '
            . 'each direction needs its own secret. No x-wp-shop-user is signed and no x-wp-shop-service is accepted until they differ.');
        return $secrets = ['host' => null, 'service' => null];
    }
    return $secrets = [
        'host' => droplets_shop_env_secret('WP_SHOP_HOST_SECRET'),
        'service' => droplets_shop_env_secret('WP_SHOP_SERVICE_SECRET'),
    ];
}

/** WP_SHOP_HOST_SECRET, for `x-wp-shop-user`, or null: no assertions to wp-shop. */
function droplets_shop_host_secret(): ?string
{
    return droplets_shop_secrets()['host'];
}

/** WP_SHOP_SERVICE_SECRET, for `x-wp-shop-service`, or null: no writes from wp-shop. */
function droplets_shop_service_secret(): ?string
{
    return droplets_shop_secrets()['service'];
}

/** Whether `$method` and `$target` are in `$routes` (method, anchored pattern). */
function droplets_shop_route_allowed(array $routes, string $method, string $target): bool
{
    foreach ($routes as [$allowed_method, $pattern]) {
        if ($method === $allowed_method && preg_match($pattern, $target) === 1) {
            return true;
        }
    }
    return false;
}

function droplets_shop_b64url(string $bytes): string
{
    return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
}

function droplets_shop_b64url_decode(string $text): string
{
    return (string) base64_decode(strtr($text, '-_', '+/'), true);
}

/**
 * `x-wp-shop-user` for a request to wp-shop at `$path` (path and query),
 * or null: nobody logged in, not an admin, no secret. A browser's unsafe
 * request gets one only when it comes from this site's own pages (its
 * `Origin`); wp-shop checks that again, as it does for every form post.
 */
function droplets_shop_user_assertion(string $method, string $path): ?string
{
    $secret = droplets_shop_host_secret();
    if ($secret === null || !is_user_logged_in() || !current_user_can('manage_options')) {
        return null;
    }
    $method = strtoupper($method);
    if (!in_array($method, ['GET', 'HEAD'], true) && droplets_shop_request_header('origin') !== droplets_shop_public_origin()) {
        return null;
    }
    $claims = [
        'sub' => wp_get_current_user()->user_login,
        'role' => 'administrator',
        'exp' => time() + DROPLETS_SHOP_ASSERTION_SECONDS,
        'method' => $method,
        'path' => $path,
        'aud' => 'wp-shop',
    ];
    $payload = droplets_shop_b64url((string) wp_json_encode($claims, JSON_UNESCAPED_SLASHES));
    return $payload . '.' . droplets_shop_b64url(hash_hmac('sha256', $payload, $secret, true));
}

/**
 * The claims of `$header` when it is a valid assertion, keyed with
 * `$secret`, for `$aud`, this method and this path, else null. The MAC is
 * checked before anything is decoded; then plain `json_decode`, each
 * claim's type, the expiry.
 */
function droplets_shop_verify_assertion(string $header, ?string $secret, string $aud, string $method, string $path): ?array
{
    if ($secret === null || strlen($header) > DROPLETS_SHOP_ASSERTION_MAX) {
        return null;
    }
    if (!preg_match('/^([A-Za-z0-9_-]{1,1000})\.([A-Za-z0-9_-]{43})$/', $header, $match)) {
        return null;
    }
    $expected = droplets_shop_b64url(hash_hmac('sha256', $match[1], $secret, true));
    if (!hash_equals($expected, $match[2])) {
        return null;
    }
    $claims = json_decode(droplets_shop_b64url_decode($match[1]), true, 4);
    if (!is_array($claims)) {
        return null;
    }
    foreach (['sub', 'role', 'exp', 'method', 'path', 'aud'] as $key) {
        if (!array_key_exists($key, $claims)) {
            return null;
        }
    }
    $now = time();
    $ok = is_string($claims['sub']) && preg_match('/^[A-Za-z0-9 _.@-]{1,60}$/', $claims['sub'])
        && $claims['role'] === 'administrator'
        && is_int($claims['exp']) && $claims['exp'] > $now && $claims['exp'] <= $now + DROPLETS_SHOP_ASSERTION_SECONDS + 5
        && $claims['method'] === strtoupper($method)
        && $claims['path'] === $path
        && $claims['aud'] === $aud;
    return $ok ? $claims : null;
}

/** The user `x-wp-shop-service` made current in this request, if any. */
$GLOBALS['droplets_shop_service_user'] = 0;

/**
 * wp-shop's write back to the REST API: `x-wp-shop-service`, for this
 * method and path, names the admin it acts for. Only the requests in
 * DROPLETS_SHOP_SERVICE_ROUTES (method and whole URI), with no method
 * override and no form fields; the user must exist and still be able to
 * `manage_options`. Anything else: the header is ignored, and WordPress's
 * own login applies. After WordPress's own checks (priority 30): its
 * cookie check at 10 returns false for a request with no cookie, and
 * would undo an earlier answer.
 */
add_filter('determine_current_user', static function ($user_id) {
    $header = $_SERVER['HTTP_X_WP_SHOP_SERVICE'] ?? null;
    if (!is_string($header)) {
        return $user_id;
    }
    $method = (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $uri = (string) ($_SERVER['REQUEST_URI'] ?? '');
    if (!droplets_shop_route_allowed(DROPLETS_SHOP_SERVICE_ROUTES, $method, $uri)
        || isset($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'])
        || $_POST !== []
    ) {
        return $user_id;
    }
    $claims = droplets_shop_verify_assertion($header, droplets_shop_service_secret(), 'wordpress', $method, $uri);
    if ($claims === null) {
        return $user_id;
    }
    $user = get_user_by('login', $claims['sub']);
    if (!($user instanceof WP_User) || !user_can($user, 'manage_options')) {
        return $user_id;
    }
    $GLOBALS['droplets_shop_service_user'] = $user->ID;
    return $user->ID;
}, 30);

/**
 * The same allow-list once WordPress has routed the request: a request the
 * service header logged in must be dispatched to one of
 * DROPLETS_SHOP_SERVICE_REST_ROUTES, with that method, whatever the URI
 * said. Anything else is refused before any callback runs.
 */
add_filter('rest_pre_dispatch', static function ($result, $server, WP_REST_Request $request) {
    get_current_user_id();
    if ($GLOBALS['droplets_shop_service_user'] === 0) {
        return $result;
    }
    if (droplets_shop_route_allowed(DROPLETS_SHOP_SERVICE_REST_ROUTES, $request->get_method(), $request->get_route())) {
        return $result;
    }
    return new WP_Error('droplets_shop_service_route', 'x-wp-shop-service does not reach this route.', ['status' => 403]);
}, 0, 3);
