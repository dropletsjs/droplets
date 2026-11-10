# The two images of docker-compose.yml, with their files baked in.

# WordPress with the plugin. The image copies /usr/src/wordpress into the
# site's volume on its first start, the plugin with it.
FROM wordpress:6-php8.3-apache AS wordpress
COPY plugin/droplets-embed /usr/src/wordpress/wp-content/plugins/droplets-embed

# WP-CLI with what site/init.sh builds the site from: site/, and the shop's
# mock data and images (the build context `shop`, examples/shop).
FROM wordpress:cli-php8.3 AS init
COPY site /site
COPY --from=shop data /shop-data/data
COPY --from=shop images /shop-data/images
