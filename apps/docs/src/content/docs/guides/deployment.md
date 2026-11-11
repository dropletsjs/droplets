---
title: Deployment
description: "What vite build produces and the ways to run it: Node, Bun, Deno, Cloudflare Workers, Docker, or inside another server."
---

## The build

```bash
vite build
```

```
dist/
  client/
    droplets.json          # manifest: build hash, entry, global CSS, per-droplet bundle and stylesheets
    index.js               # /index.js: imports env.js (with runtime public variables) and assets/index.<hash>.js
    droplets/<id>/client.js  # one bundle per droplet that hydrates
    droplets/<id>/style.css  # what /droplets/<id>/style.css answers, for a droplet with stylesheets
    assets/                # entry client (index.<hash>.js), stylesheets, shared chunks
  server/entry-server.js   # the SSR renderer
  server/_prerendered/     # build-time renders, for droplets with prerender = true; never served
  server.js                # the HTTP server, with droplets.config.ts baked in
```

`dist/server.js` bundles the framework's own dependencies (Hono, your
renderers' server runtimes). What stays external is whatever your droplets and your config
import from `node_modules`. A project whose droplets import nothing beyond
their framework produces a `dist/` that runs with no `node_modules` at all.

## Adapters

The runtime, the routes, the renderer and the element contract use web APIs
only (`Request`, `Response`, `fetch`, `TextEncoder`, `atob`), so they run on
any JavaScript runtime. What differs per runtime is the thin entry around
them: how the SSR bundle is loaded, how the client build is read, how the
process listens. An **adapter** supplies that entry, SvelteKit-style, and is
required for `vite build`:

```ts
// vite.config.ts
import { droplets } from "@dropletsjs/droplets/vite";
import { svelte } from "@dropletsjs/renderer-svelte";
import { node } from "@dropletsjs/adapter-node";

export default defineConfig({ plugins: [droplets({ adapter: node(), renderers: [svelte()] })] });
```

| Adapter | Package | Emits |
| --- | --- | --- |
| `node()` | `@dropletsjs/adapter-node` | `dist/server.js` + `dist/server/entry-server.js`; reads `dist/client` and `dist/server/_prerendered` from disk, serves only `/assets/` as files (`public/` at `/assets/public/`). `vite preview` uses it too. |
| `cloudflare()` | `@dropletsjs/adapter-cloudflare` | `dist/worker.js`, self-contained, renderer and manifest inlined; `dist/client` served by Workers Static Assets. |
| `bun()` | `@dropletsjs/adapter-bun` | As `node()`; `bun dist/server.js` serves it. |
| `deno()` | `@dropletsjs/adapter-deno` | As `node()`; `deno serve -A dist/server.js` serves it. |

An adapter is a small object (`DropletsAdapter` in `@dropletsjs/droplets`):
the server entry to bundle, the output file name, whether the SSR renderer is
emitted separately, `noExternal` patterns or `true` to bundle everything,
extra Vite environment options, an `afterBuild` hook and an optional
`preview`. The entry itself calls `createServerApp({ ssr, assets, config })`
with loaders for its platform, and gets the config, the renderer and the
manifest through `virtual:droplets-config`, `virtual:droplets-ssr` and
`virtual:droplets-manifest`. The shipped adapters are the reference:
`packages/adapters/node` and `packages/adapters/cloudflare` in the repository;
`bun` and `deno` only change how `node`'s app is served. Prerendered renders
are server-only: an adapter with `separateSsrBundle` reads them from
`dist/server/_prerendered/`; one without finds them in the client build under
the manifest's `__prerendered`, a directory named anew every build, and must
keep the manifest itself private. `createPrerenderedLoader(read)` takes a
`read` rooted at that directory.

## Cloudflare Workers

```bash
pnpm add -D @dropletsjs/adapter-cloudflare@alpha wrangler
```

```ts
import { cloudflare } from "@dropletsjs/adapter-cloudflare";
export default defineConfig({ plugins: [droplets({ adapter: cloudflare(), renderers: [svelte()] })] });
```

```jsonc
// wrangler.jsonc
{
  "name": "my-droplets",
  "main": "dist/worker.js",
  "compatibility_date": "2025-10-01",
  // Server renderers (Svelte's among them) use AsyncLocalStorage from node:async_hooks.
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "dist/client",
    "binding": "ASSETS",
    // Every request reaches the Worker, files included.
    "run_worker_first": true
  }
}
```

```bash
vite build
wrangler dev        # local, in workerd
wrangler deploy
```

### `run_worker_first`

Set `run_worker_first` to `true`, or to a list that covers `/index.js`,
`/droplets/*` and `/assets/*` (`["/index.js", "/droplets/*", "/assets/*"]`,
or `["/*"]`). The Worker answers `/index.js` with the stub that records
where it was loaded from, and reads `/droplets/*` and `/assets/*` through
the binding to send them with CORS and their cache headers.

Without it, Workers Static Assets answer those paths before the Worker
runs. `/index.js` and the bundles go out without the Worker's CORS headers,
and `/index.js` is the bare entry file, without the stub (the location
record, runtime public env variables) and without `no-store`, so a browser
or CDN may keep it past the next deploy. A page on another origin cannot
load the droplets at all.

The adapter reads your wrangler config (`wrangler.jsonc`, `wrangler.json` or
`wrangler.toml`) after `vite build` and warns once when `run_worker_first`
is `false`, unset, or a list that misses one of those paths. The build goes
on: the setting is yours. It also warns when the file does not parse.

The Worker bundles everything, so there are no `node_modules` at runtime.
`PORT` and `server.port` do not apply. Environment variables come from the
Worker's bindings, and `platform.env` in server code holds them all.
Prerendered droplets are read through the assets binding, from
`dist/client/_prerendered/<random>/`: a name new every build that only the
Worker's inlined manifest holds, so no assets config makes them reachable at
a URL one could guess. `public/` is in `dist/client/assets/public/`, served at
`/assets/public/*` with `no-cache` and the binding's `ETag`. `vite build` also writes `dist/client/.assetsignore`,
which keeps `droplets.json` and `.vite/` out of the upload. Set `cors` in `droplets.config.ts` if
pages on other origins embed your droplets. On the free plan this is enough
to host a droplets server for a documentation site or a demo.

## Plain Node

```bash
PORT=8000 node dist/server.js
```

`PORT` overrides `server.port` from the config. It logs errors only, to
stderr; see [Logging](#logging).

Importing `dist/server.js` instead of running it does **not** start listening.
It exports `{ fetch }`, a standard `Request => Promise<Response>` handler.

## Bun

```bash
PORT=8000 bun dist/server.js
```

The default export is `{ port, fetch }`, and Bun serves it when the file is
the entry point; `PORT` overrides `server.port`, as on Node. Imported, it
hands over `fetch` and does not listen.

## Deno

```bash
deno serve -A --port 8000 dist/server.js
```

`deno serve` serves the default export `{ fetch }` and owns the port: `--port`
(8000 by default) rather than `PORT` or `server.port`. `--parallel` runs one
worker per CPU core. `-A` grants what the server needs: reading `dist/`, the
environment for `$droplets/env/private`, and the network. Packages your
droplets import come from `node_modules`, as with Node: `deno install` puts
them there for a project with a `package.json`.

## Docker

A build stage that runs `vite build`, and a runtime stage that copies only
`dist/`:

```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8000
COPY --from=build /app/dist ./dist
EXPOSE 8000
USER node
CMD ["node", "dist/server.js"]
```

If your droplets import packages that are not bundled, also copy
`node_modules` (or run `pnpm install --prod` in the runtime stage). The
repository's `examples/frameworks/Dockerfile` is the same thing for a
workspace package (`--build-arg EXAMPLE=vue` picks the example); the
[host examples](/integrate/hosts/overview/) run against the image it builds.

## Inside another server

Because `dist/server.js` exports a fetch handler, any Node server can mount
it. With Express and `@hono/node-server`:

```js
import express from "express";
import { getRequestListener } from "@hono/node-server";

const droplets = (await import("./dist/server.js")).default;
const app = express();

app.get("/", (req, res) => res.send("my page"));
app.use(getRequestListener(droplets.fetch));   // /index.js, /droplets/*, /assets/*, /api/*

app.listen(3000);
```

Droplet routes and your routes then share one origin: no CORS, no
`x-droplet-location`, and the page can call
`droplets.fetch(new Request(url))` in-process to render fragments without an
HTTP round trip. The
[Express example](/integrate/hosts/express/) shows both this and the usual
separate-process setup.

## Behind a proxy

When a reverse proxy fronts the droplets server:

- forward `/index.js`, `/index.css`, `/droplets/*` and `/assets/*` to it (and
  `/api/*` and `/importmap` if you use them);
- set `x-droplet-location` to the public URL, written out in the proxy's
  configuration (never built from the request's `Host`, and overwriting any
  `x-droplet-location` a client sent), so fragments point at the proxy. Under
  a path, include it: `x-droplet-location: https://shop.example/mfe`. Set its
  origin as [`origin`](/guides/configuration/) (or `DROPLETS_ORIGIN`): the
  server ignores a location whose origin is not its own, in `origin` or in
  `trustedOrigins`. A proxy that already sends `Forwarded` or
  `X-Forwarded-Proto` and `X-Forwarded-Host` (with `X-Forwarded-Prefix` under
  a path) is read the same way, when `x-droplet-location` is absent. Keep the
  droplets server unreachable except through the proxy;
- keep the `cache-control` headers it sends; they are safe to honour: `/index.js`
  is `no-store`, fragments and `_data` are `private, no-store`
  (`fragmentCacheControl`), `/assets/public/*` is `no-cache` with an `ETag`,
  everything else it serves for the browser is immutable.

### `/index.js` and CDNs

The elements load from where the page loaded `/index.js`, prefix included:
it records its own URL. So `/index.js` must come from the droplets
server, under its prefix: `https://shop.example/mfe/index.js` makes the
elements load from `https://shop.example/mfe`. A CDN in front works when it
pulls from the server at the same URL (origin pull); `/index.js` is
`no-store`, `/assets/public/*` revalidates, the rest is immutable and caches well. Copying the files to
another bucket under another URL does not: there is no option that bakes a
location into the build.

### Trusted origins at runtime

`DROPLETS_TRUSTED_ORIGINS` (comma-separated origins) adds to `trustedOrigins`
from the config, read at runtime on every adapter (a Worker's binding, the
process environment on Node, Bun and Deno). One build can then trust
different hosts per deployment. An entry that is not an origin is skipped,
with a warning.

### `DROPLETS_SECRET`

Forms posted without JavaScript are answered with a redirect back to the
host page, the action's result signed in its URL
([Post/Redirect/Get](/guides/actions/#without-javascript-postredirectget)).
Set `DROPLETS_SECRET` to 32 or more random bytes (`openssl rand -base64 32`),
the same on every instance serving a build, as a secret: a Worker secret, the
process environment elsewhere. It is read at runtime and never reaches a
browser bundle. Without it such a post answers the droplet's fragment
instead (`vite dev` says so once). Rotating it voids the results minted in
the last five minutes, nothing else.

A host that fetches fragments on its server can pass their
[`Link` header](/integrate/http-contract/#the-link-header) on with its page, so
the browser starts on the stylesheets, the entry and the bundles early.

See the [nginx example](/integrate/hosts/nginx/) for a complete configuration, and
[Security model](/guides/security/) for what the droplets server trusts.

## Health and readiness

`GET /health` (the `health` option) answers `ok` with status `200` as soon as
the server is listening, before `handle` runs. The SSR bundle is loaded on the
first request that needs it.

## Logging

A production server logs errors only, with `console.error`: a message, then
the error itself, nothing else. Those are:

- a droplet's load failed (`<droplet>: droplet load failed`);
- a form action failed;
- an action's `redirect()` points off this server and its trusted origins,
  answered `400`;
- a request failed (`<where> failed: <path>`, such as `droplet failed:
  /droplets/cart`);
- `handleError` in `hooks.server.ts` failed, or could not be loaded;
- on Node, Bun and Deno, `dist/client/droplets.json` is missing (not built).

Warnings are for `vite dev` and `vite build`, and never reach a production
bundle: an untrusted forwarded location, `"*"` in `origin` or
`trustedOrigins`, an entry of `DROPLETS_ORIGIN` or `DROPLETS_TRUSTED_ORIGINS`
that is not one, `DROPLETS_SECRET` missing or too short, `cors` allowing
every origin, a malformed `x-droplet-props`, an action result over 2 KB. Set
their level with `DEV_DROPLETS_LOG` (`error`, `warn`, `info`, the default,
or `debug`); a production server ignores it.

## What `/` serves

In production and `vite preview`, `/` serves the `index` page: the file the
option names, else `index.html` in the project root, else a small placeholder.
It is served as written, not processed by Vite. `index: false` answers `404`.
