# syntax=docker/dockerfile:1
#
# Builds the shop example into a droplets server image on port 8300.
# Build from the repository root, since the example depends on the workspace:
#
#   docker build -f examples/shop/Dockerfile -t droplets-shop .
#   docker run --rm -p 8300:8300 \
#     -e ADMIN_PASSWORD=droplets -e SHOP_SECRET=$(openssl rand -hex 32) \
#     -e DROPLETS_SECRET=$(openssl rand -hex 32) droplets-shop
#
# The database is seeded at image build, because the build's `entries()` read
# it (one prerendered page per product, the full comment pages). It lives in
# the container: a new container starts from the seed again. No secret is
# baked in: without SHOP_SECRET (32+ characters) the login answers 503, and
# without DROPLETS_SECRET (32+ bytes) a form posted without JavaScript gets
# the droplet's fragment instead of the redirect back to the host page.
# The server keeps kysely, better-sqlite3 and the frameworks external, so the
# runtime stage carries the shop's production node_modules (`pnpm deploy`).

FROM node:24-bookworm-slim AS build
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
COPY examples/shop/package.json examples/shop/
RUN pnpm install --frozen-lockfile --filter @dropletsjs/example-shop...

COPY packages packages
COPY examples/shop examples/shop
RUN pnpm --filter '@dropletsjs/example-shop^...' build \
 && cd examples/shop \
 && node scripts/seed.ts \
 && pnpm exec vite build \
 && pnpm --filter @dropletsjs/example-shop deploy --legacy --prod /app \
 && cp -r dist images data shop.db /app/

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8300 \
    ADMIN_USER=admin
COPY --from=build --chown=node:node /app ./
# SQLite writes its -wal and -shm files, and uploads land, next to shop.db.
RUN chown node:node /app
EXPOSE 8300
USER node
CMD ["node", "dist/server.js"]
