<?php
/**
 * The shop's catalogue, as WordPress content (examples/wp-shop reads it
 * over the REST API):
 *
 * - the `product` post type, `show_in_rest` at `wp/v2/products`: the title,
 *   the description as the content, the image as the featured image (the
 *   Media Library), comments on;
 * - its meta, in REST with a schema: `shop_price_cents`, `shop_stock`,
 *   `shop_sale_pct` (the campaign's discount on it, 0 for none),
 *   `shop_category`, `shop_details`; written by an editor of the post only;
 * - a "Shop" meta box on its edit screen (the classic one) for the same
 *   fields;
 * - anonymous REST comments on products, which is how wp-shop posts a
 *   visitor's comment. WordPress's moderation, flood and duplicate checks
 *   still apply.
 *
 * Not public: `/product/<slug>` is the Product page with the shop's
 * fragments (shop.php), never WordPress's own view of the post.
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/** The shop's categories: the same slugs as wp-shop's src/lib/categories.ts. */
const DROPLETS_SHOP_CATEGORIES = [
    'mugs' => 'Mugs & cups',
    'desk' => 'Desk',
    'bags' => 'Bags',
    'home' => 'Home',
];

function droplets_shop_register_catalogue(): void
{
    register_post_type('product', [
        'labels' => [
            'name' => 'Products',
            'singular_name' => 'Product',
            'add_new_item' => 'Add product',
            'edit_item' => 'Edit product',
            'all_items' => 'All products',
        ],
        'public' => false,
        'show_ui' => true,
        'show_in_menu' => true,
        'menu_icon' => 'dashicons-cart',
        'show_in_rest' => true,
        'rest_base' => 'products',
        'supports' => ['title', 'editor', 'thumbnail', 'comments', 'custom-fields'],
        'rewrite' => false,
        'query_var' => false,
    ]);

    $edit = static fn($allowed, $key, $post_id): bool => current_user_can('edit_post', (int) $post_id);
    $meta = [
        'shop_price_cents' => ['type' => 'integer', 'default' => 100, 'minimum' => 1, 'maximum' => 10000000],
        'shop_stock' => ['type' => 'integer', 'default' => 0, 'minimum' => 0, 'maximum' => 99999],
        'shop_sale_pct' => ['type' => 'integer', 'default' => 0, 'minimum' => 0, 'maximum' => 90],
        'shop_category' => ['type' => 'string', 'default' => 'home', 'enum' => array_keys(DROPLETS_SHOP_CATEGORIES)],
        'shop_details' => ['type' => 'string', 'default' => '', 'maxLength' => 300],
    ];
    foreach ($meta as $key => $schema) {
        register_post_meta('product', $key, [
            'type' => $schema['type'],
            'single' => true,
            'default' => $schema['default'],
            'show_in_rest' => ['schema' => $schema],
            'auth_callback' => $edit,
            'sanitize_callback' => $schema['type'] === 'integer'
                ? static fn($value) => (int) $value
                : static fn($value) => sanitize_text_field((string) $value),
        ]);
    }
}
add_action('init', 'droplets_shop_register_catalogue');

/** Products are edited on the classic screen: the title, the text, the image, the Shop box. */
add_filter('use_block_editor_for_post_type', static fn(bool $use, string $type) => $type === 'product' ? false : $use, 10, 2);

/** The meta box instead of the raw Custom Fields one. */
add_action('add_meta_boxes_product', static function (): void {
    remove_meta_box('postcustom', 'product', 'normal');
    add_meta_box('droplets-shop', 'Shop', 'droplets_shop_meta_box', 'product', 'side', 'high');
});

function droplets_shop_meta_box(WP_Post $post): void
{
    wp_nonce_field('droplets_shop_meta', 'droplets_shop_nonce');
    $value = static fn(string $key) => get_post_meta($post->ID, $key, true);
    $price = number_format(((int) $value('shop_price_cents')) / 100, 2, '.', '');
    printf('<p><label>Price (€)<br><input name="shop_price" value="%s" inputmode="decimal" class="widefat"></label></p>', esc_attr($price));
    printf('<p><label>Stock<br><input name="shop_stock" type="number" min="0" max="99999" value="%d" class="widefat"></label></p>', (int) $value('shop_stock'));
    printf('<p><label>Sale (%%)<br><input name="shop_sale_pct" type="number" min="0" max="90" value="%d" class="widefat"></label></p>', (int) $value('shop_sale_pct'));
    echo '<p><label>Category<br><select name="shop_category" class="widefat">';
    foreach (DROPLETS_SHOP_CATEGORIES as $slug => $name) {
        printf('<option value="%s"%s>%s</option>', esc_attr($slug), selected($value('shop_category'), $slug, false), esc_html($name));
    }
    echo '</select></label></p>';
    printf('<p><label>Details<br><input name="shop_details" value="%s" class="widefat" placeholder="300 ml · Stoneware"></label></p>', esc_attr((string) $value('shop_details')));
}

/** The box's fields, each checked; nothing else of the form is read. */
add_action('save_post_product', static function (int $post_id): void {
    if (!isset($_POST['droplets_shop_nonce']) || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['droplets_shop_nonce'])), 'droplets_shop_meta')) {
        return;
    }
    if ((defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) || wp_is_post_revision($post_id) || !current_user_can('edit_post', $post_id)) {
        return;
    }
    $field = static fn(string $name) => isset($_POST[$name]) && is_string($_POST[$name]) ? trim(sanitize_text_field(wp_unslash($_POST[$name]))) : null;
    $price = $field('shop_price');
    if ($price !== null && preg_match('/^(\d{1,5})(?:[.,](\d{1,2}))?$/', $price, $m)) {
        update_post_meta($post_id, 'shop_price_cents', max(1, (int) $m[1] * 100 + (int) str_pad($m[2] ?? '0', 2, '0')));
    }
    $whole = static fn(?string $text, int $max) => $text !== null && preg_match('/^\d{1,5}$/', $text) ? min($max, (int) $text) : null;
    if (($stock = $whole($field('shop_stock'), 99999)) !== null) {
        update_post_meta($post_id, 'shop_stock', $stock);
    }
    if (($pct = $whole($field('shop_sale_pct'), 90)) !== null) {
        update_post_meta($post_id, 'shop_sale_pct', $pct);
    }
    $category = $field('shop_category');
    if ($category !== null && array_key_exists($category, DROPLETS_SHOP_CATEGORIES)) {
        update_post_meta($post_id, 'shop_category', $category);
    }
    $details = $field('shop_details');
    if ($details !== null) {
        update_post_meta($post_id, 'shop_details', mb_substr($details, 0, 300));
    }
});

/** The products list in wp-admin shows price and stock. */
add_filter('manage_product_posts_columns', static fn(array $columns) => array_merge($columns, ['shop_price' => 'Price', 'shop_stock' => 'Stock']));
add_action('manage_product_posts_custom_column', static function (string $column, int $post_id): void {
    if ($column === 'shop_price') {
        echo esc_html('€' . number_format(((int) get_post_meta($post_id, 'shop_price_cents', true)) / 100, 2));
    } elseif ($column === 'shop_stock') {
        echo (int) get_post_meta($post_id, 'shop_stock', true);
    }
}, 10, 2);

/** wp-shop posts a visitor's comment anonymously, on products only. */
add_filter('rest_allow_anonymous_comments', static function (bool $allowed, WP_REST_Request $request): bool {
    return $allowed || get_post_type((int) $request->get_param('post')) === 'product';
}, 10, 2);
