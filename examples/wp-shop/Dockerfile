# syntax=docker/dockerfile:1
#
# wp-shop: the shop's droplets, backed by WordPress. Build from the
# repository root, since the example depends on the workspace:
#
#   docker build -f examples/wp-shop/Dockerfile -t droplets-wp-shop .
#
# examples/hosts/wordpress/docker-compose.yml runs it next to WordPress.
#
# Unlike examples/shop, the image holds the sources, not a build: the build
# prerenders from WordPress's REST API, so it runs at container start, once
# WordPress answers (scripts/start.sh). The image therefore keeps the dev
# dependencies (Vite and the renderers). No secret is baked in: without
# WP_SHOP_HOST_SECRET (32+ bytes) no WordPress admin is recognized; without
# WP_SHOP_SERVICE_SECRET (32+ bytes, not the host secret) nothing is written
# back; without DROPLETS_SECRET (32+ bytes) a form posted
# without JavaScript gets the droplet's fragment instead of the redirect back.

FROM node:24-bookworm-slim
# better-sqlite3 builds from source where no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@10.20.0
WORKDIR /repo

# Install first, so dependency layers are cached across source changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/droplets/package.json packages/droplets/
COPY packages/adapters/node/package.json packages/adapters/node/
COPY packages/adapters/bun/package.json packages/adapters/bun/
COPY packages/adapters/deno/package.json packages/adapters/deno/
COPY packages/adapters/cloudflare/package.json packages/adapters/cloudflare/
COPY packages/devtools/package.json packages/devtools/
COPY packages/create-droplets/package.json packages/create-droplets/
COPY packages/renderers/svelte/package.json packages/renderers/svelte/
COPY packages/renderers/vue/package.json packages/renderers/vue/
COPY packages/renderers/solid/package.json packages/renderers/solid/
COPY packages/renderers/react/package.json packages/renderers/react/
COPY packages/renderers/handlebars/package.json packages/renderers/handlebars/
COPY packages/renderers/hono-jsx/package.json packages/renderers/hono-jsx/
COPY examples/wp-shop/package.json examples/wp-shop/
RUN pnpm install --frozen-lockfile --filter @dropletsjs/example-wp-shop...

COPY packages packages
RUN pnpm --filter '@dropletsjs/example-wp-shop^...' build
COPY examples/wp-shop examples/wp-shop
# The build at start writes dist/ and .droplets/, the cart its SQLite file.
RUN rm -rf examples/wp-shop/dist examples/wp-shop/node_modules/.vite examples/wp-shop/wp-shop.db* \
 && chown -R node:node examples/wp-shop

WORKDIR /repo/examples/wp-shop
ENV NODE_ENV=production \
    PORT=8310
EXPOSE 8310
USER node
CMD ["sh", "scripts/start.sh"]
