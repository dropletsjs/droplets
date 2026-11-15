# nginx with this folder's page baked in. The config is a template: the
# image writes conf.d/default.conf from it at start, with the droplets
# server's public URL of docker-compose.yml filled in.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY html /usr/share/nginx/html
