#!/bin/sh
# The site, built with WP-CLI by the wordpress-init service, so no wizard is
# left to click through. Demo values only: admin / droplets.
#
# Once, on an empty database: WordPress installed with the stock Twenty
# Twenty-Five theme; the shop's catalogue imported (site/import.php: the
# products as `product` posts with their meta, images in the Media Library,
# comments as WordPress comments); the pages Gallery, Product
# (/product/<slug>) and Cart with the shop's shortcodes, About, a Journal
# with two posts; the primary menu; the header and footer template parts,
# as the Site Editor would save them (the header holds the cart badge).
# The shop's admin is no page: it is the Shop screen in wp-admin (the
# plugin's shop-admin.php). Every start: the plugin activated and the rewrite rules flushed, so
# /product/<slug> resolves.
#
# The plugin is activated last: it registers the `product` post type in the
# REST API, which is what wp-shop waits for before it builds (and
# prerenders) from it, so the catalogue is complete by then.
set -eu
cd /var/www/html

# The wordpress container writes wp-config.php on its first start.
until [ -f wp-config.php ] && wp db query "SELECT 1" >/dev/null 2>&1; do sleep 2; done

# As the admin, so block markup is saved as written (no kses on it).
wpa() { wp --user=admin "$@"; }

# page <slug> <title> <file> [template]: publishes a page, prints its id.
page() {
  id=$(wpa post create "/site/pages/$3" --post_type=page --post_status=publish --post_name="$1" --post_title="$2" --porcelain)
  if [ -n "${4:-}" ]; then wpa post meta set "$id" _wp_page_template "$4" >/dev/null; fi
  echo "$id"
}

# link <label> <page id> <path>: a menu item for a page.
link() {
  printf '<!-- wp:navigation-link {"label":"%s","type":"page","id":%s,"url":"%s","kind":"post-type"} /-->\n' "$1" "$2" "$3"
}

# part <slug> <area> <title>: the theme's template part, customized.
part() {
  id=$(sed "s/__PRIMARY_NAV__/$nav/" "/site/parts/$1.html" \
    | wpa post create - --post_type=wp_template_part --post_status=publish --post_name="$1" --post_title="$3" --porcelain)
  wpa post term set "$id" wp_theme twentytwentyfive >/dev/null
  wpa post term set "$id" wp_template_part_area "$2" >/dev/null
}

if ! wp core is-installed; then
  wp core install --url="${WP_PUBLIC_URL:-http://localhost:8008}" --title="Droplets Shop" \
    --admin_user=admin --admin_password=droplets --admin_email=admin@example.com --skip-email
  wp theme activate twentytwentyfive
  wp option update blogdescription "A demo shop: WordPress pages, droplets inside."
  # No trailing slash: the shop's own links are /gallery and /product/<slug>.
  wp rewrite structure "/%postname%"
  # "Hello world!" and "Sample Page".
  wp post delete 1 2 --force
  # Visitors' comments come through wp-shop, without an email address, and
  # show at once (WordPress's flood and duplicate checks still apply).
  wp option update require_name_email 0
  wp option update comment_previously_approved 0

  # The catalogue: mock data, examples/shop's (in the image at /shop-data).
  wpa eval-file /site/import.php

  # The Svelte example stays the front page: its droplets, one per mode.
  home=$(wpa post create --post_type=page --post_status=publish --post_name=droplets --post_title="Droplets" --porcelain \
    --post_content='[droplet id="client" who="WordPress"] [droplet id="ssr-hydrate" who="WordPress"] [droplet id="ssr-nohydrate" who="WordPress"]')
  wp option update show_on_front page
  wp option update page_on_front "$home"

  gallery=$(page gallery "Gallery" gallery.html page-no-title)
  page product "Product" product.html page-no-title >/dev/null
  cart=$(page cart "Cart" cart.html)
  about=$(page about "About" about.html)
  journal=$(wpa post create --post_type=page --post_status=publish --post_name=journal --post_title="Journal" --porcelain)
  wp option update page_for_posts "$journal"

  wpa post create /site/posts/opening.html --post_status=publish --post_title="The shop is open" \
    --post_date="$(date -u -d "@$(($(date +%s) - 2 * 86400))" '+%Y-%m-%d %H:%M:%S')" >/dev/null
  wpa post create /site/posts/how-it-is-built.html --post_status=publish --post_title="How the shop is built" >/dev/null

  nav=$({
    link Gallery "$gallery" /gallery
    link Cart "$cart" /cart
    link Journal "$journal" /journal
    link About "$about" /about
  } | wpa post create - --post_type=wp_navigation --post_status=publish --post_title="Primary" --porcelain)
  part header header Header
  part footer footer Footer
fi

wp plugin activate droplets-embed
wp rewrite flush
wp theme list --status=active --field=name
