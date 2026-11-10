<?php
/**
 * The shop's demo catalogue, into WordPress: `wp eval-file /site/import.php`
 * (site/init.sh, once, before the plugin is activated). Mock data, the
 * same that examples/shop seeds its SQLite with: examples/shop/data/*.json
 * and examples/shop/images, copied to /shop-data in the image.
 *
 * - each product a `product` post: the name as its title, the description
 *   as its content, published days to months ago;
 * - its meta: `shop_price_cents`, `shop_stock`, `shop_sale_pct` (20 on
 *   every fourth product, the running campaign), `shop_category`,
 *   `shop_details`;
 * - its image in the Media Library, as the featured image;
 * - its comments as native, approved WordPress comments, dated as seeded.
 *
 * Does nothing when products are there already.
 */

if (!defined('ABSPATH')) {
    exit(1);
}

require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';
require_once ABSPATH . 'wp-admin/includes/image.php';

$data = '/shop-data';
if (get_posts(['post_type' => 'product', 'post_status' => 'any', 'numberposts' => 1, 'fields' => 'ids'])) {
    WP_CLI::log('products are there already: nothing to import');
    return;
}

$read = static function (string $file) use ($data) {
    $json = json_decode((string) file_get_contents("{$data}/data/{$file}"), true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($json)) {
        WP_CLI::error("{$file}: not JSON");
    }
    return $json;
};
$catalogue = $read('products.json');
$comments = $read('comments.json');

$day = 86400;
$now = time();
// Stock that shows every state on the first gallery page: out, low, plenty (as examples/shop's seed).
$stock = [12, 3, 25, 0, 8, 40, 2, 15, 9, 30, 18, 5, 22, 7, 60, 14, 0, 11, 33, 4];

// Comments per product, oldest first, in days ago.
$bySlug = [];
foreach ($comments as $comment) {
    $bySlug[$comment['product']][] = $comment;
}
$daysAgo = static function (array $list): array {
    $days = [];
    foreach (array_values($list) as $i => $comment) {
        $days[] = (float) ($comment['daysAgo'] ?? (count($list) - $i) * 3);
    }
    rsort($days);
    return $days;
};
$gmt = static fn(int $at) => gmdate('Y-m-d H:i:s', $at);

$imported = 0;
$posted = 0;
foreach (array_values($catalogue['products']) as $i => $product) {
    $slug = (string) $product['slug'];
    $list = $bySlug[$slug] ?? [];
    $oldest = $daysAgo($list)[0] ?? 0;
    // Spread over four months; every fifth one is new (NEW for two weeks), never younger than its oldest comment.
    $age = max($i % 5 === 2 ? 3 + $i / 5 : 20 + $i * 6, $oldest + 2);
    $created = (int) round($now - $age * $day);

    $id = wp_insert_post([
        'post_type' => 'product',
        'post_status' => 'publish',
        'post_name' => $slug,
        'post_title' => (string) $product['name'],
        'post_content' => (string) $product['description'],
        'post_date_gmt' => $gmt($created),
        'post_date' => get_date_from_gmt($gmt($created)),
        'comment_status' => 'open',
        'post_author' => 1,
    ], true);
    if (is_wp_error($id)) {
        WP_CLI::error("{$slug}: " . $id->get_error_message());
    }
    update_post_meta($id, 'shop_price_cents', (int) $product['priceCents']);
    update_post_meta($id, 'shop_stock', $stock[$i % count($stock)]);
    update_post_meta($id, 'shop_sale_pct', $i % 4 === 0 ? 20 : 0);
    update_post_meta($id, 'shop_category', (string) $product['category']);
    update_post_meta($id, 'shop_details', (string) ($product['details'] ?? ''));

    // The image into the Media Library (a copy: sideloading moves the file).
    $tmp = wp_tempnam("{$slug}.webp");
    copy("{$data}/images/{$slug}.webp", $tmp);
    $media = media_handle_sideload(['name' => "{$slug}.webp", 'tmp_name' => $tmp], $id, (string) $product['name']);
    if (is_wp_error($media)) {
        WP_CLI::error("{$slug}.webp: " . $media->get_error_message());
    }
    set_post_thumbnail($id, $media);

    // Its comments, oldest first, dated as seeded.
    $days = $daysAgo($list);
    usort($list, static fn($a, $b) => ($b['daysAgo'] ?? 0) <=> ($a['daysAgo'] ?? 0));
    foreach ($list as $n => $comment) {
        $at = (int) round($now - $days[$n] * $day - (strlen($slug) % 7) * 3600);
        wp_insert_comment([
            'comment_post_ID' => $id,
            'comment_author' => mb_substr((string) $comment['author'], 0, 40),
            'comment_content' => mb_substr((string) $comment['body'], 0, 1000),
            'comment_date_gmt' => $gmt($at),
            'comment_date' => get_date_from_gmt($gmt($at)),
            'comment_approved' => 1,
        ]);
        $posted++;
    }
    $imported++;
}
WP_CLI::success("imported {$imported} products and {$posted} comments");
