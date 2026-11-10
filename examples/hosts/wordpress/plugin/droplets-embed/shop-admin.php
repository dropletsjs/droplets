<?php
/**
 * The shop's admin (examples/wp-shop's `product-admin` droplet: stock and
 * prices) lives in wp-admin, as the top-level "Shop" page, for users who
 * can `manage_options`. It is on no public page:
 *
 * - `[shop_droplet id="product-admin"]` renders nothing of it on the
 *   public site (shop.php asks droplets_shop_is_public());
 * - `/admin`, which no page answers, redirects here (wp-admin then sends
 *   a visitor who is not logged in to wp-login.php);
 * - none of the public droplets (gallery, cart, toasts) are put here.
 *
 * The fragment is fetched on the server, as on the public pages
 * (droplets_shop_fragments(): the admin's signed `x-wp-shop-user` for this
 * one GET, this screen's URL as `Referer`, the fixed `x-host`), before
 * wp-admin prints anything, and printed by the menu page's callback.
 * `/index.js` and the screen's stylesheet are enqueued on this screen only.
 * The droplet's own requests (its `?/save` posts) go to `/droplets/…`
 * through the same-origin proxy, which signs them as it does everywhere:
 * that method and path, `aud: "wp-shop"`, and for a post only when its
 * `Origin` is this site.
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/** The screen's slug: wp-admin/admin.php?page=droplets-shop. */
const DROPLETS_SHOP_ADMIN_PAGE = 'droplets-shop';

/** Who sees the screen: the same capability the assertion asks for. */
const DROPLETS_SHOP_ADMIN_CAPABILITY = 'manage_options';

/** The droplets that only this screen renders, never a public page. */
const DROPLETS_SHOP_ADMIN_DROPLETS = ['product-admin'];

/** Whether `$id` may render on the public site. */
function droplets_shop_is_public(string $id): bool
{
    return !in_array($id, DROPLETS_SHOP_ADMIN_DROPLETS, true);
}

/** The Shop screen's URL in wp-admin. */
function droplets_shop_admin_url(): string
{
    return admin_url('admin.php?page=' . DROPLETS_SHOP_ADMIN_PAGE);
}

/** The screen's hook suffix (`toplevel_page_droplets-shop`), once the menu is registered. */
$GLOBALS['droplets_shop_admin_hook'] = '';

/** What the screen fetched before wp-admin printed anything. */
$GLOBALS['droplets_shop_admin_result'] = null;

add_action('admin_menu', static function (): void {
    $hook = add_menu_page(
        'Shop',
        'Shop',
        DROPLETS_SHOP_ADMIN_CAPABILITY,
        DROPLETS_SHOP_ADMIN_PAGE,
        'droplets_shop_admin_screen',
        'dashicons-store',
        26
    );
    if (is_string($hook) && $hook !== '') {
        $GLOBALS['droplets_shop_admin_hook'] = $hook;
        add_action('load-' . $hook, 'droplets_shop_admin_load');
    }
});

/**
 * Before the screen prints (`load-<hook>`, after wp-admin's own capability
 * check): the fragment, and its `Set-Cookie`. A redirect or any answer
 * that is not HTML is never inserted (droplets_shop_fragments() makes it
 * a notice).
 */
function droplets_shop_admin_load(): void
{
    if (!current_user_can(DROPLETS_SHOP_ADMIN_CAPABILITY)) {
        wp_die(esc_html__('Sorry, you are not allowed to access this page.'), 403);
    }
    $results = droplets_shop_fragments(['admin' => ['product-admin', []]]);
    $result = $results['admin'];
    foreach ($result['cookies'] as $cookie) {
        header('Set-Cookie: ' . $cookie, false);
    }
    $GLOBALS['droplets_shop_admin_result'] = $result;
}

/** The menu page: wp-admin's frame, the droplet inside the screen's own scope. */
function droplets_shop_admin_screen(): void
{
    if (!current_user_can(DROPLETS_SHOP_ADMIN_CAPABILITY)) {
        return;
    }
    $result = $GLOBALS['droplets_shop_admin_result'];
    echo '<div class="wrap" id="droplets-shop-admin">';
    // The droplet says who is logged in and links the rest of wp-admin's product screens.
    printf('<h1>%s</h1>', esc_html('Shop: stock and prices'));
    // Trusted markup from our own shop server (or droplets_shop_fragments()'s
    // escaped notice); it must not be escaped.
    echo '<div class="droplets-shop-admin-droplet">', is_array($result) ? $result['html'] : '', '</div>';
    echo '</div>';
}

/** The loader and the screen's stylesheet, on the Shop screen only. */
add_action('admin_enqueue_scripts', static function (string $hook_suffix): void {
    if ($GLOBALS['droplets_shop_admin_hook'] === '' || $hook_suffix !== $GLOBALS['droplets_shop_admin_hook']) {
        return;
    }
    wp_enqueue_style('droplets-shop-admin', plugins_url('shop-admin.css', __FILE__), [], '1');
    wp_enqueue_script_module('droplets-shop', '/index.js', [], null);
});

/** The fragment's `Link` preloads (this origin only), in the screen's head. */
add_action('admin_head', static function (): void {
    $result = $GLOBALS['droplets_shop_admin_result'];
    if (!is_array($result)) {
        return;
    }
    $links = droplets_shop_link_tags([$result]);
    if ($links !== '') {
        echo $links, "\n";
    }
});

/**
 * `/admin` is no page: it goes to the Shop screen (and from there to
 * wp-login.php for a visitor). First on `template_redirect`: before the
 * shop fetches the header's fragments for the 404 page, and before
 * WordPress's own guess (wp_redirect_admin_locations, the dashboard).
 */
add_action('template_redirect', static function (): void {
    if (!is_404()) {
        return;
    }
    $path = (string) wp_parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
    if (preg_match('#^/admin/?$#D', $path)) {
        wp_safe_redirect(droplets_shop_admin_url(), 302);
        exit;
    }
}, 1);
