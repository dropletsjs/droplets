# Laravel 13 on PHP 8.5 with Apache (mod_php). Composer runs in a stage of
# its own; the image keeps the app and its vendor/ only.
FROM composer:2 AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction
COPY artisan ./
COPY app app
COPY bootstrap bootstrap
COPY config config
COPY public public
COPY resources resources
COPY routes routes
COPY storage storage
RUN composer dump-autoload --no-dev --optimize --classmap-authoritative

# The feature tests (tests/), with Laravel's HTTP fake: `docker build --target test .`
FROM vendor AS test
RUN composer install --prefer-dist --no-interaction
COPY phpunit.xml ./
COPY tests tests
RUN vendor/bin/phpunit

FROM php:8.5-apache
COPY apache.conf /etc/apache2/sites-available/000-default.conf
COPY php.ini /usr/local/etc/php/conf.d/host.ini
COPY --from=vendor /app /var/www/app
WORKDIR /var/www/app
# Laravel logs to stderr, which the image sends to `docker compose logs`.
ENV LOG_CHANNEL=stderr
# The config stays uncached: it reads the environment compose gives the container.
RUN php artisan route:cache && php artisan view:cache \
    && chown -R www-data:www-data storage bootstrap/cache
EXPOSE 80
