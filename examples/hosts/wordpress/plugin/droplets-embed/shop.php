<?php
/**
 * The shop (examples/wp-shop: the shop's droplets, backed by this site) on
 * this WordPress site:
 *
 * - a same-origin proxy for what the browser asks the shop for (`/index.js`,
 *   `/droplets/*`, `/assets/*`, `/api/*`), so its cart cookie is first-party
 *   and nothing is cross-origin;
 * - the `[shop_droplet]` and `[shop_product]` shortcodes, which put the
 *   shop's fragments into ordinary pages and template parts of the theme.
 *   The site's pages (Gallery, /product/<slug>, Cart) are made by WP-CLI
 *   (`site/init.sh`). The admin droplet is never one of them: it is the
 *   Shop screen in wp-admin (shop-admin.php);
 * - for a logged-in admin, the signed `x-wp-shop-user` on every fragment
 *   fetch and every proxied `/droplets/*` and `/api/*` request
 *   (shop-identity.php): the WordPress account is the shop's only login.
 *
 * The catalogue itself (the `product` post type, its meta, the meta box)
 * is in shop-catalogue.php.
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * What the browser's request may tell the shop; nothing that names a host,
 * and never `x-wp-shop-user`: that one is the plugin's alone to send.
 * `cookie` goes on filtered (droplets_shop_cookie_header()).
 */
const DROPLETS_SHOP_REQUEST_HEADERS = [
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

/** Per hop, or no longer true once the body has been decoded. */
const DROPLETS_SHOP_DROPPED_RESPONSE_HEADERS = [
    'connection',
    'content-encoding',
    'content-length',
    'keep-alive',
    'set-cookie',
    'transfer-encoding',
];

/**
 * The shop's own cookies, the only ones it is sent: WordPress's login
 * cookies stay on this site. Who is logged in reaches the shop as the
 * signed `x-wp-shop-user` instead.
 */
const DROPLETS_SHOP_COOKIES = ['cart_id'];

/** The page `/product/<slug>` renders (its slug). */
const DROPLETS_SHOP_PRODUCT_PAGE = 'product';

/** How WordPress reaches the shop (inside Docker: the service name). */
function droplets_shop_internal_url(): string
{
    return rtrim(getenv('SHOP_INTERNAL_URL') ?: 'http://localhost:8300', '/');
}

/**
 * This site's public origin. It goes out as `x-droplet-location` on every
 * request to the shop, written out in the environment: never the client's
 * Host.
 */
function droplets_shop_public_origin(): string
{
    $url = wp_parse_url(getenv('SHOP_PUBLIC_URL') ?: 'http://localhost:8008');
    $port = isset($url['port']) ? ':' . $url['port'] : '';
    return ($url['scheme'] ?? 'http') . '://' . ($url['host'] ?? 'localhost') . $port;
}

/** The browser's request header `$name`, or null. */
function droplets_shop_request_header(string $name): ?string
{
    $key = strtoupper(str_replace('-', '_', $name));
    $value = $_SERVER['HTTP_' . $key] ?? ($key === 'CONTENT_TYPE' ? ($_SERVER['CONTENT_TYPE'] ?? null) : null);
    return is_string($value) && $value !== '' ? $value : null;
}

/** The browser's `Cookie` header with the shop's cookies only, or null. */
function droplets_shop_cookie_header(): ?string
{
    $kept = [];
    foreach (explode(';', (string) droplets_shop_request_header('cookie')) as $pair) {
        $name = trim(explode('=', $pair, 2)[0]);
        if (in_array($name, DROPLETS_SHOP_COOKIES, true)) {
            $kept[] = trim($pair);
        }
    }
    return $kept === [] ? null : implode('; ', $kept);
}

/** The page's query as `[key, value]` pairs, repeated keys kept (PHP's `$_GET` would merge them). */
function droplets_shop_query(): array
{
    $pairs = [];
    $raw = (string) ($_SERVER['QUERY_STRING'] ?? '');
    foreach ($raw === '' ? [] : explode('&', $raw) as $piece) {
        if ($piece === '') {
            continue;
        }
        [$key, $value] = array_pad(explode('=', $piece, 2), 2, '');
        $pairs[] = [rawurldecode(str_replace('+', ' ', $key)), rawurldecode(str_replace('+', ' ', $value))];
    }
    return $pairs;
}

/** The pairs named in `$keys`, in that order. */
function droplets_shop_pick(array $pairs, array $keys): array
{
    $picked = [];
    foreach ($keys as $key) {
        foreach ($pairs as $pair) {
            if ($pair[0] === $key) {
                $picked[] = $pair;
            }
        }
    }
    return $picked;
}

/** `[key, value]` pairs → a query string, every piece encoded. */
function droplets_shop_build_query(array $pairs): string
{
    return implode('&', array_map(static fn(array $pair) => rawurlencode($pair[0]) . '=' . rawurlencode($pair[1]), $pairs));
}

// ---- The proxy ------------------------------------------------------------

/**
 * PHP reads multipart bodies into `$_POST` and `$_FILES` and leaves
 * `php://input` empty, so a multipart post (the admin's image upload) is
 * written out again. Field order is lost (fields, then files), and a name
 * repeated without `[]` keeps its last value, as PHP parsed it.
 */
function droplets_shop_multipart_body(string &$content_type): string
{
    $boundary = '----droplets' . bin2hex(random_bytes(12));
    $content_type = 'multipart/form-data; boundary=' . $boundary;
    $quote = static fn(string $value) => str_replace(['"', "\r", "\n"], ['%22', '%0D', '%0A'], $value);
    $body = '';
    $part = static function (string $name, string $value, ?string $filename = null, string $type = '') use (&$body, $boundary, $quote): void {
        $body .= "--{$boundary}\r\nContent-Disposition: form-data; name=\"" . $quote($name) . '"';
        if ($filename !== null) {
            $body .= '; filename="' . $quote($filename) . "\"\r\nContent-Type: "
                . (preg_match('#^[\w.+-]+/[\w.+-]+$#', $type) ? $type : 'application/octet-stream');
        }
        $body .= "\r\n\r\n{$value}\r\n";
    };

    foreach (wp_unslash($_POST) as $name => $value) {
        foreach (is_array($value) ? $value : [$value] as $item) {
            if (is_scalar($item)) {
                $part(is_array($value) ? "{$name}[]" : (string) $name, (string) $item);
            }
        }
    }
    foreach ($_FILES as $name => $file) {
        $many = is_array($file['name']);
        foreach ((array) $file['name'] as $index => $filename) {
            $error = $many ? $file['error'][$index] : $file['error'];
            $tmp = $many ? $file['tmp_name'][$index] : $file['tmp_name'];
            $type = (string) ($many ? $file['type'][$index] : $file['type']);
            $field = $many ? "{$name}[]" : (string) $name;
            if ($error === UPLOAD_ERR_NO_FILE) {
                $part($field, '', '', 'application/octet-stream');
            } elseif ($error === UPLOAD_ERR_OK && is_uploaded_file($tmp)) {
                $part($field, (string) file_get_contents($tmp), (string) $filename, $type);
            }
        }
    }
    return $body . "--{$boundary}--\r\n";
}

/** Passes the request on to the shop and its answer back, untouched; never follows a redirect. */
function droplets_shop_proxy(string $request_uri): void
{
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    $headers = [];
    foreach (DROPLETS_SHOP_REQUEST_HEADERS as $name) {
        $value = droplets_shop_request_header($name);
        if ($value !== null) {
            $headers[$name] = $value;
        }
    }
    $cookie = droplets_shop_cookie_header();
    if ($cookie !== null) {
        $headers['cookie'] = $cookie;
    }
    $headers['x-droplet-location'] = droplets_shop_public_origin();
    // A logged-in admin's fragments, `_data`, actions and `/api`: the
    // assertion, for this method and this path (shop-identity.php).
    if (preg_match('#^/(?:droplets|api)/#', $request_uri)) {
        // A bare trailing `?` is no query to wp-shop's URL parser either.
        $assertion = droplets_shop_user_assertion($method, (string) preg_replace('/\?$/', '', $request_uri));
        if ($assertion !== null) {
            $headers[DROPLETS_SHOP_USER_HEADER] = $assertion;
        }
    }

    $body = null;
    if ($method !== 'GET' && $method !== 'HEAD') {
        $body = (string) file_get_contents('php://input');
        $type = $headers['content-type'] ?? '';
        if ($body === '' && stripos($type, 'multipart/form-data') === 0) {
            $body = droplets_shop_multipart_body($type);
            $headers['content-type'] = $type;
        }
    }

    // Concatenated, not resolved: a path like `//elsewhere` stays a path on the shop.
    $response = wp_remote_request(droplets_shop_internal_url() . $request_uri, [
        'method' => $method,
        'headers' => $headers,
        'body' => $body,
        'redirection' => 0,
        'timeout' => 15,
    ]);

    if (is_wp_error($response)) {
        status_header(502);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'The shop is unreachable.';
        exit;
    }

    status_header((int) wp_remote_retrieve_response_code($response));
    $headers = wp_remote_retrieve_headers($response);
    foreach (is_object($headers) ? $headers->getAll() : (array) $headers as $name => $values) {
        $name = strtolower((string) $name);
        $values = (array) $values;
        if ($name === 'set-cookie') {
            // Untouched: the shop never sets Domain, so they belong to this origin.
            foreach ($values as $cookie) {
                header('Set-Cookie: ' . $cookie, false);
            }
        } elseif (!in_array($name, DROPLETS_SHOP_DROPPED_RESPONSE_HEADERS, true)) {
            header($name . ': ' . implode(', ', $values));
        }
    }
    if ($method !== 'HEAD') {
        echo wp_remote_retrieve_body($response);
    }
    exit;
}

/** Whether `$path` has a `.` or `..` segment once decoded: never a shop route. */
function droplets_shop_has_dot_segment(string $path): bool
{
    foreach (explode('/', $path) as $segment) {
        if (in_array(rawurldecode($segment), ['.', '..'], true)) {
            return true;
        }
    }
    return false;
}

/** On `init`, before WordPress routes anything: the shop's own paths go to the shop. */
function droplets_shop_route_proxy(): void
{
    $request_uri = (string) ($_SERVER['REQUEST_URI'] ?? '');
    if ($request_uri === '' || $request_uri[0] !== '/') {
        return;
    }
    $path = (string) strtok($request_uri, '?');
    if (preg_match('#^/(?:index\.js$|env\.js$|index\.css$|droplets/|assets/|api/)#', $path)) {
        if (droplets_shop_has_dot_segment($path)) {
            status_header(400);
            header('Content-Type: text/plain; charset=utf-8');
            echo 'Bad request.';
            exit;
        }
        droplets_shop_proxy($request_uri);
    }
}
add_action('init', 'droplets_shop_route_proxy', 0);

// ---- Fragments ------------------------------------------------------------

/**
 * Fetches `GET /droplets/<id>?<query>` for each of `$wanted` (`[id, pairs]`),
 * in parallel, as the browser's request: its cookies, this page as the host.
 * Each answer: `html`, `status`,
 * `location`, `cookies`, `link`. Only an HTML answer is a fragment (a 500
 * carries the droplet's error page); anything else may echo the props, so
 * it is never inserted.
 */
function droplets_shop_fragments(array $wanted): array
{
    $origin = droplets_shop_public_origin();
    $headers = [
        'accept' => 'text/html',
        'x-droplet-location' => $origin,
        'referer' => $origin . (string) ($_SERVER['REQUEST_URI'] ?? '/'),
    ];
    $cookie = droplets_shop_cookie_header();
    if ($cookie !== null) {
        $headers['cookie'] = $cookie;
    }

    $requests = [];
    foreach ($wanted as $key => [$id, $pairs]) {
        // No bare `?`: the path must be the one wp-shop sees, as the assertion names it.
        $query = droplets_shop_build_query($pairs);
        $path = '/droplets/' . rawurlencode($id) . ($query === '' ? '' : '?' . $query);
        // Each fetch its own assertion: it names this path, query included.
        $assertion = droplets_shop_user_assertion('GET', $path);
        $requests[$key] = [
            'url' => droplets_shop_internal_url() . $path,
            'headers' => $assertion === null ? $headers : $headers + [DROPLETS_SHOP_USER_HEADER => $assertion],
            'type' => 'GET',
            'options' => ['follow_redirects' => false, 'timeout' => 5],
        ];
    }
    $responses = $requests === [] ? [] : WpOrg\Requests\Requests::request_multiple($requests);

    $results = [];
    foreach ($wanted as $key => [$id]) {
        $response = $responses[$key] ?? null;
        $result = ['html' => '', 'status' => 502, 'location' => null, 'cookies' => [], 'link' => null];
        if ($response instanceof WpOrg\Requests\Response) {
            $result['status'] = (int) $response->status_code;
            $result['cookies'] = $response->headers->getValues('set-cookie') ?? [];
            $result['link'] = $response->headers['link'];
            $is_html = str_starts_with((string) $response->headers['content-type'], 'text/html');
            if ($result['status'] >= 300 && $result['status'] < 400) {
                $result['location'] = $response->headers['location'];
            } elseif ((($result['status'] >= 200 && $result['status'] < 300) || $result['status'] === 500) && $is_html) {
                // Trusted markup from our own shop server; it must not be escaped.
                $result['html'] = $response->body;
                $results[$key] = $result;
                continue;
            }
        }
        $reason = $result['status'] === 502 ? 'unreachable' : 'HTTP ' . $result['status'];
        $result['html'] = sprintf('<p class="shop-unavailable">The %s droplet is unavailable (%s).</p>', esc_html($id), esc_html($reason));
        $results[$key] = $result;
    }
    return $results;
}

/** A product's name, category and id, from the product page's public `_data` read. */
function droplets_shop_product(string $slug): ?array
{
    $response = wp_remote_get(droplets_shop_internal_url() . '/droplets/product-page/_data?' . droplets_shop_build_query([['slug', $slug]]), [
        'timeout' => 5,
        'redirection' => 0,
        'headers' => ['x-droplet-location' => droplets_shop_public_origin(), 'accept' => 'application/json'],
    ]);
    if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) {
        return null;
    }
    $body = json_decode(wp_remote_retrieve_body($response), true);
    $product = is_array($body) ? ($body['data']['product'] ?? null) : null;
    return is_array($product) && is_string($product['id'] ?? null) && is_string($product['name'] ?? null) ? $product : null;
}

/** The fragments' `Link` preloads, as tags for the page's head: on this origin only. */
function droplets_shop_link_tags(array $results): string
{
    $origin = droplets_shop_public_origin();
    $tags = [];
    foreach ($results as $result) {
        foreach (preg_split('/,(?=\s*<)/', (string) $result['link']) as $part) {
            if (!preg_match('/^\s*<([^>]*)>(.*)$/', $part, $match)) {
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
            $as = isset($params['as']) ? sprintf(' as="%s"', esc_attr($params['as'])) : '';
            $tags[$href . $rel] = sprintf('<link rel="%s" href="%s"%s>', esc_attr($rel), esc_url($href), $as);
        }
    }
    return implode("\n", $tags);
}

// ---- Shortcodes in the theme's pages ---------------------------------------

/**
 * What this request has fetched: the fragments by key, the product of
 * `/product/<slug>`, the head's preloads, and the HTML the shortcodes left
 * placeholders for.
 */
function &droplets_shop_state(): array
{
    static $state = ['results' => [], 'product' => null, 'not_found' => false, 'links' => '', 'slots' => [], 'buffering' => false, 'toasts' => false];
    return $state;
}

/**
 * `[shop_droplet id="…" query="…" …]` as `[id, pairs]`: `query` names the
 * page's query keys to forward (`*` for all of them), every other attribute
 * is a fixed prop.
 */
function droplets_shop_wanted(array $atts): ?array
{
    $id = sanitize_key((string) ($atts['id'] ?? ''));
    if ($id === '') {
        return null;
    }
    $fixed = [];
    foreach ($atts as $key => $value) {
        if (is_string($key) && $key !== 'id' && $key !== 'query') {
            $fixed[] = [$key, (string) $value];
        }
    }
    $forward = trim((string) ($atts['query'] ?? ''));
    $page = droplets_shop_query();
    $pairs = $forward === '*' ? $page : droplets_shop_pick($page, array_values(array_filter(array_map('trim', explode(',', $forward)))));
    $names = array_column($fixed, 0);
    $pairs = array_values(array_filter($pairs, static fn(array $pair) => !in_array($pair[0], $names, true)));
    return [$id, array_merge($fixed, $pairs)];
}

function droplets_shop_key(array $wanted): string
{
    return $wanted[0] . '?' . droplets_shop_build_query($wanted[1]);
}

/** The product page's two fragments, for `$product`, from the page's query. */
function droplets_shop_product_wanted(array $product): array
{
    $query = droplets_shop_query();
    // `v`, when the link had one: the shop serves its build's page for the
    // current version and redirects an old one to this URL without it.
    $page = array_merge([['slug', (string) ($product['slug'] ?? '')]], droplets_shop_pick($query, ['v']));
    $comments = droplets_shop_pick($query, ['order', 'page', 'showing']);
    $comments[] = ['productId', $product['id']];
    return ['page' => ['product-page', $page], 'comments' => ['product-comments', $comments]];
}

/** The `[shop_*]` shortcodes in `$content`, as `[tag, atts]`. */
function droplets_shop_shortcodes(string $content): array
{
    if (!str_contains($content, '[shop_')) {
        return [];
    }
    preg_match_all('/' . get_shortcode_regex(['shop_droplet', 'shop_product']) . '/', $content, $matches, PREG_SET_ORDER);
    return array_map(static function (array $match): array {
        $atts = shortcode_parse_atts($match[3]);
        return [$match[2], is_array($atts) ? $atts : []];
    }, $matches);
}

/** The post a page request is for, when its content holds a shop shortcode. */
function droplets_shop_page_post(): ?WP_Post
{
    $post = is_singular() ? get_queried_object() : null;
    return $post instanceof WP_Post && str_contains($post->post_content, '[shop_') ? $post : null;
}

/**
 * Before the theme renders: finds the shop shortcodes in this page and in
 * the header and footer template parts, fetches every fragment in parallel,
 * passes on their `Set-Cookie` and any redirect, and starts the buffer the
 * shortcodes' placeholders are filled into. The fragments go into the page
 * as the shop sent them, after WordPress's own content filters
 * (`wptexturize`, smilies, image attributes) are done.
 */
function droplets_shop_template_redirect(): void
{
    $state = &droplets_shop_state();
    $sources = [];
    foreach (['header', 'footer'] as $part) {
        $template = get_block_template(get_stylesheet() . '//' . $part, 'wp_template_part');
        if ($template !== null) {
            $sources[] = (string) $template->content;
        }
    }
    $post = droplets_shop_page_post();
    if ($post !== null) {
        $sources[] = $post->post_content;
    }

    $wanted = [];
    foreach ($sources as $content) {
        foreach (droplets_shop_shortcodes($content) as [$tag, $atts]) {
            if ($tag === 'shop_product') {
                $slug = (string) get_query_var('shop_product');
                if ($slug === '') {
                    wp_safe_redirect(home_url('/gallery'));
                    exit;
                }
                $state['product'] = droplets_shop_product($slug);
                $state['not_found'] = $state['product'] === null;
                foreach ($state['product'] === null ? [] : droplets_shop_product_wanted($state['product']) as $one) {
                    $wanted[droplets_shop_key($one)] = $one;
                }
            } elseif (($one = droplets_shop_wanted($atts)) !== null && droplets_shop_is_public($one[0])) {
                $wanted[droplets_shop_key($one)] = $one;
            }
        }
    }
    if ($wanted === [] && !$state['not_found']) {
        return;
    }
    // A shop page: the toasts too, first (`wp_body_open` puts them in).
    $toasts = droplets_shop_toasts_wanted();
    $wanted = [droplets_shop_key($toasts) => $toasts] + $wanted;
    $state['toasts'] = true;

    $state['results'] = droplets_shop_fragments($wanted);
    foreach ($state['results'] as $result) {
        foreach ($result['cookies'] as $cookie) {
            header('Set-Cookie: ' . $cookie, false);
        }
    }
    foreach ($state['results'] as $result) {
        if ($result['location'] !== null) {
            wp_redirect($result['location'], $result['status']);
            exit;
        }
    }
    header('Cache-Control: private, no-store');
    if ($state['not_found']) {
        status_header(404);
    }
    $state['links'] = droplets_shop_link_tags($state['results']);
    $state['buffering'] = ob_start('droplets_shop_fill');
    wp_enqueue_script_module('droplets-shop', '/index.js', [], null);
}
add_action('template_redirect', 'droplets_shop_template_redirect', 20);

/** The buffer's end: each placeholder gets its fragment back, byte for byte. */
function droplets_shop_fill(string $html): string
{
    return strtr($html, droplets_shop_state()['slots']);
}

/** A placeholder for `$html` while the page buffers, else `$html` itself. */
function droplets_shop_slot(string $html): string
{
    $state = &droplets_shop_state();
    if (!$state['buffering']) {
        return $html;
    }
    $token = '<!--djs-shop:' . count($state['slots']) . '-->';
    $state['slots'][$token] = $html;
    return $token;
}

/** A fragment fetched before the theme rendered, or now when this one was not. */
function droplets_shop_fragment(array $wanted): string
{
    $state = &droplets_shop_state();
    $key = droplets_shop_key($wanted);
    if (!isset($state['results'][$key])) {
        $state['results'] += droplets_shop_fragments([$key => $wanted]);
        foreach (headers_sent() ? [] : $state['results'][$key]['cookies'] as $cookie) {
            header('Set-Cookie: ' . $cookie, false);
        }
        wp_enqueue_script_module('droplets-shop', '/index.js', [], null);
    }
    return droplets_shop_slot($state['results'][$key]['html']);
}

/**
 * [shop_droplet id="product-library" query="*"]
 * [shop_droplet id="shopping-cart" variant="inline"]
 *
 * Not the admin droplet: on a public page it is never fetched, whoever is
 * logged in. It is the Shop screen in wp-admin.
 */
function droplets_shop_droplet_shortcode(array|string $atts): string
{
    $wanted = droplets_shop_wanted(is_array($atts) ? $atts : []);
    if ($wanted === null) {
        return '<p class="shop-unavailable">[shop_droplet] needs an id attribute</p>';
    }
    if (!droplets_shop_is_public($wanted[0])) {
        return sprintf('<p class="shop-unavailable">The %s droplet is in wp-admin only.</p>', esc_html($wanted[0]));
    }
    return droplets_shop_fragment($wanted);
}
add_shortcode('shop_droplet', 'droplets_shop_droplet_shortcode');

/** [shop_product]: the product of `/product/<slug>`, its breadcrumbs and its comments. */
function droplets_shop_product_shortcode(): string
{
    $state = &droplets_shop_state();
    $product = $state['product'];
    if (!is_array($product)) {
        return '<div class="shop-notice"><h1>Not found</h1><p>This product does not exist.</p><p><a href="/gallery">Back to the gallery</a></p></div>';
    }
    $wanted = droplets_shop_product_wanted($product);
    $category = is_array($product['category'] ?? null) ? $product['category'] : [];
    $crumbs = sprintf(
        '<nav class="shop-crumbs" aria-label="Breadcrumb"><a href="/gallery">Gallery</a> › <a href="%s">%s</a> › <span aria-current="page">%s</span></nav>',
        esc_attr('/gallery?' . droplets_shop_build_query([['category', (string) ($category['slug'] ?? '')]])),
        esc_html((string) ($category['name'] ?? '')),
        esc_html($product['name'])
    );
    return $crumbs . "\n" . droplets_shop_fragment($wanted['page'])
        . "\n" . '<section class="shop-comments">' . droplets_shop_fragment($wanted['comments']) . '</section>';
}
add_shortcode('shop_product', 'droplets_shop_product_shortcode');

/** The toast-center droplet: client-only, no props. */
function droplets_shop_toasts_wanted(): array
{
    return ['toast-center', []];
}

/**
 * On a shop page, the toasts come first in the body, before the theme's
 * header: their script installs the page's message queue
 * (`window.shopMessageQueue`) early. Once per page.
 */
add_action('wp_body_open', static function (): void {
    $state = &droplets_shop_state();
    if ($state['toasts']) {
        $state['toasts'] = false;
        echo droplets_shop_fragment(droplets_shop_toasts_wanted()), "\n";
    }
});

// ---- Routing and the head -------------------------------------------------

/** `/product/<slug>` is the Product page, with the slug as `shop_product`. */
function droplets_shop_rewrite(): void
{
    add_rewrite_rule('^product/([^/]+)/?$', 'index.php?pagename=' . DROPLETS_SHOP_PRODUCT_PAGE . '&shop_product=$matches[1]', 'top');
}
add_action('init', 'droplets_shop_rewrite');

add_filter('query_vars', static fn(array $vars) => array_merge($vars, ['shop_product']));

/**
 * The shop's pager uses `?page=N`, which WordPress reads as a page of a
 * paginated post (and would 404 or redirect). On a page with a shop
 * shortcode it is the shop's alone.
 */
add_filter('request', static function (array $vars): array {
    if (isset($vars['page'], $vars['pagename'])) {
        $post = get_page_by_path((string) $vars['pagename']);
        if ($post instanceof WP_Post && str_contains($post->post_content, '[shop_')) {
            unset($vars['page']);
        }
    }
    return $vars;
});

/** A shop page's URL is the shop's: its query stays as it is. */
add_filter('redirect_canonical', static fn($url) => droplets_shop_page_post() !== null ? false : $url);

add_filter('document_title_parts', static function (array $parts): array {
    $state = droplets_shop_state();
    if (is_array($state['product'])) {
        $parts['title'] = $state['product']['name'];
    } elseif ($state['not_found']) {
        $parts['title'] = 'Not found';
    }
    return $parts;
});

add_action('wp_head', static function (): void {
    $links = droplets_shop_state()['links'];
    if ($links !== '') {
        echo $links, "\n";
    }
}, 1);

add_action('wp_enqueue_scripts', static function (): void {
    wp_enqueue_style('droplets-shop', plugins_url('shop.css', __FILE__), [], '1');
});
