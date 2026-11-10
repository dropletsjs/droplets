# htmx from npm (the version package-lock.json pins, its integrity checked),
# copied next to the static pages; nginx serves them. The config is a
# template: the image writes conf.d/default.conf from it at start, with the
# two public URLs of docker-compose.yml filled in.
FROM node:24-alpine AS htmx
WORKDIR /htmx
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY html /usr/share/nginx/html
COPY --from=htmx /htmx/node_modules/htmx.org/dist/htmx.min.js /usr/share/nginx/html/vendor/htmx.min.js
