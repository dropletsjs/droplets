# Plain PHP on Apache (mod_php). curl, the only extension the host uses, is
# built into the official image: no Composer, nothing to install.
FROM php:8.3-apache
COPY apache.conf /etc/apache2/sites-available/000-default.conf
COPY php.ini /usr/local/etc/php/conf.d/host.ini
COPY app /var/www/app/app
COPY public /var/www/app/public
EXPOSE 80
