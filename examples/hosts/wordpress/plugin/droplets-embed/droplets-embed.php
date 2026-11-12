<?php
/**
 * Plugin Name: Droplets Embed
 * Description: Embed droplets served by a droplets server with the [droplet] shortcode, and the shop (examples/wp-shop) with [shop_droplet] and [shop_product]: its products, their meta and comments are this site's, its admin is the Shop screen in wp-admin, for this site's login.
 * Version: 0.1.0
 * Requires at least: 6.5
 * Requires PHP: 8.1
 * License: MIT
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

// The shop: [shop_droplet] and [shop_product] in the site's pages, /product/<slug>, and its proxy;
// the `product` post type it reads over REST; the WordPress login it trusts; its admin, in wp-admin.
require_once __DIR__ . '/shop-identity.php';
require_once __DIR__ . '/shop-catalogue.php';
require_once __DIR__ . '/shop.php';
require_once __DIR__ . '/shop-admin.php';

// /product/<slug> is a rewrite rule: written out when the plugin is activated.
register_activation_hook(__FILE__, static function (): void {
    droplets_shop_register_catalogue();
    droplets_shop_rewrite();
    flush_rewrite_rules(false);
});

/** Server-to-server address (inside Docker: the service name). */
function droplets_internal_url(): string
{
    return rtrim(getenv('DROPLETS_INTERNAL_URL') ?: 'http://localhost:8000', '/');
}

/** Browser-facing address, written onto every fragment. */
function droplets_public_url(): string
{
    return rtrim(getenv('DROPLETS_PUBLIC_URL') ?: 'http://localhost:8000', '/');
}

/**
 * [droplet id="ssr-hydrate" who="WordPress"]
 *
 * Every attribute other than `id` is forwarded to the droplet as a prop. The
 * fragment is fetched server-side, so the post arrives with the droplet
 * already rendered; the entry client (enqueued below) hydrates it.
 */
function droplets_shortcode(array|string $atts): string
{
    $atts = is_array($atts) ? $atts : [];
    $id = isset($atts['id']) ? sanitize_key((string) $atts['id']) : '';
    if ($id === '') {
        return '<p class="error">[droplet] needs an id attribute</p>';
    }
    unset($atts['id']);

    $url = droplets_internal_url() . '/droplets/' . rawurlencode($id);
    if ($atts !== []) {
        $url .= '?' . http_build_query($atts);
    }

    $response = wp_remote_get($url, [
        'timeout' => 5,
        'redirection' => 0,
        'headers' => ['accept' => 'text/html', 'x-droplet-location' => droplets_public_url()],
    ]);

    if (is_wp_error($response)) {
        return sprintf(
            '<p class="error">droplet "%s" unavailable: %s</p>',
            esc_html($id),
            esc_html($response->get_error_message())
        );
    }
    // Only an HTML answer is a fragment (a 500 carries the droplet's error
    // page); anything else may echo the props, so it is never pasted.
    $status = (int) wp_remote_retrieve_response_code($response);
    $is_html = str_starts_with((string) wp_remote_retrieve_header($response, 'content-type'), 'text/html');
    if (!(($status >= 200 && $status < 300) || $status === 500) || !$is_html) {
        return sprintf('<p class="error">droplet "%s" unavailable: HTTP %d</p>', esc_html($id), $status);
    }

    droplets_enqueue_client();
    // Trusted markup from our own droplets server; it must not be escaped.
    return wp_remote_retrieve_body($response);
}
add_shortcode('droplet', 'droplets_shortcode');

/** Adds `/index.js` to the page once, as a module script. */
function droplets_enqueue_client(): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    $src = droplets_public_url() . '/index.js';
    if (function_exists('wp_enqueue_script_module')) {
        wp_enqueue_script_module('droplets-client', $src, [], null);
    } else {
        // Older WordPress: plain script tag with type="module".
        add_action('wp_footer', static function () use ($src): void {
            printf('<script type="module" src="%s"></script>', esc_url($src));
        });
    }
}
