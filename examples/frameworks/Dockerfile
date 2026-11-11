# syntax=docker/dockerfile:1
#
# Builds one framework example into a self-contained droplets server image;
# EXAMPLE names its folder (svelte by default). Build from the repository
# root, since the example depends on the workspace:
#
#   docker build -f examples/frameworks/Dockerfile -t droplets-svelte .
#   docker build -f examples/frameworks/Dockerfile --build-arg EXAMPLE=vue -t droplets-vue .
#   docker run --rm -p 8000:8000 droplets-svelte
#
# `vite build` bundles Hono and Droplets itself into dist/, but keeps the
# framework external, so the runtime stage carries the example's production
# node_modules (`pnpm deploy`) next to dist/.

FROM node:24-alpine AS build
RUN npm install -g pnpm@10.20.0
WORKDIR /repo

# Fetch first, so the dependency layer is cached across source changes.
# `pnpm fetch` reads only the lockfile, so no workspace package is listed here.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch --ignore-scripts

ARG EXAMPLE=svelte
COPY packages packages
COPY examples/frameworks/${EXAMPLE} examples/frameworks/${EXAMPLE}
RUN CI=true pnpm install --offline --frozen-lockfile --filter "@dropletsjs/example-${EXAMPLE}..."

# The static variables are inlined at build. The example's .env holds them,
# but .dockerignore leaves .env files out, so the demo values come from here.
ARG PUBLIC_SITE_NAME="Droplets showcase"
ARG BUILD_CHANNEL=example
RUN pnpm --filter "@dropletsjs/example-${EXAMPLE}^..." build \
 && pnpm --filter "@dropletsjs/example-${EXAMPLE}" build \
 && pnpm --filter "@dropletsjs/example-${EXAMPLE}" deploy --legacy --prod /app \
 && cp -r "examples/frameworks/${EXAMPLE}/dist" /app/

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8000
COPY --from=build /app ./
EXPOSE 8000
USER node
CMD ["node", "dist/server.js"]
