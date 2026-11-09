# nginx with this folder's config and pages baked in. The config is a
# template: the image writes conf.d/default.conf from it at start, with the
# two public URLs of docker-compose.yml filled in.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY html /usr/share/nginx/html
COPY shop /usr/share/nginx/shop
