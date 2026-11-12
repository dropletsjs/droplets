# Droplets

**Server-rendered components you can embed from any stack.**

[![npm](https://img.shields.io/npm/v/@dropletsjs/droplets?label=%40dropletsjs%2Fdroplets)](https://www.npmjs.com/package/@dropletsjs/droplets)
[![CI](https://github.com/dropletsjs/droplets/actions/workflows/ci.yml/badge.svg)](https://github.com/dropletsjs/droplets/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Docs](https://img.shields.io/badge/docs-dropletsjs.dev-0ea5e9.svg)](https://dropletsjs.dev)

*If micro-frontends were a framework.* Droplets grew out of SvelteKit and
keeps the patterns that work there: `+` files, `load`, form actions with
`fail()` and `redirect()`, server and client hooks, `$droplets/env/*`,
prerendering with `entries`. They are reshaped for islands of
server-rendered HTML that live inside someone else's page. Droplets is an
independent project, not affiliated with Svelte or SvelteKit.

A droplet is one component with its own URL, served by a small Hono server:
server-rendered, bundled on its own, addressable on its own. Write it in
Svelte, Vue, React, Preact, Solid, Hono JSX, Handlebars or Lit. Any page, served by
anything, fetches the fragment, pastes it in and loads one script. The unit
of delivery is the component, not the page.

```
GET /droplets/hello?who=Ana   →  <djs-droplet …>Hello Ana!</djs-droplet>
GET /index.js                 →  the one script that makes every droplet on the page live
```

**Docs:** [dropletsjs.dev](https://dropletsjs.dev).

## Status

**1.0.0** is the first public release: the HTTP contract, the config and
the renderer API are what the docs describe, and a breaking change to any
of them is a major release, with its changelog saying how. The packages all
share one version. Try it, embed it, report what breaks.

## Try it

```bash
npm create droplets my-widgets
```

It asks for the folder, the custom element's name, the frameworks, the
adapters and Tailwind, then writes a typed project with one starter droplet
per framework, installs it and makes the first commit. `--yes` asks nothing
(the folder and `--frameworks` are then required); `pnpm`, `yarn` and `bun create droplets`
work too. See [Getting started](https://dropletsjs.dev/start/getting-started/).

```bash
cd my-widgets
npm run dev      # http://localhost:5173: pick a droplet, edit its props, watch it render
npm run build    # dist/, for the adapter you picked
```

## By hand

```bash
pnpm add @dropletsjs/droplets @dropletsjs/renderer-svelte svelte
pnpm add -D vite typescript @dropletsjs/adapter-node @dropletsjs/devtools
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { svelte } from "@dropletsjs/renderer-svelte";
import { dropletsDevtools } from "@dropletsjs/devtools";
import { node } from "@dropletsjs/adapter-node";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [svelte()] }), dropletsDevtools()],
});
```

```svelte
<!-- src/droplets/hello/+droplet.svelte -->
<script lang="ts">
  import type { DropletProps } from "./$types";
  let { data }: DropletProps = $props();
</script>

<h1>Hello {data.who}!</h1>
```

```ts
// src/droplets/hello/+droplet.server.ts
import type { LoadEvent } from "./$types";

export const load = ({ props }: LoadEvent) => ({
  who: typeof props.who === "string" ? props.who : "world",
});
```

`vite` to develop, `vite build` to build, `node dist/server.js` to run. Swap
the adapter for `cloudflare()` from `@dropletsjs/adapter-cloudflare`
and the same build becomes a Worker; `bun()` and `deno()` serve it on those
runtimes. `./$types` is each droplet's generated types (`data` is what the
load returns); [Manual setup](https://dropletsjs.dev/start/manual-setup/) has
the tsconfig that maps it, the typings and the scripts.

## Embed from any stack

A host page needs nothing from Droplets but HTTP: fetch the fragment on its
server (or let the element fetch it in the browser), paste it in, load
`/index.js` once.

| Route | Returns |
| --- | --- |
| `GET`/`POST /droplets/:id` | The fragment (props from the query, or a JSON body); a form body runs an action |
| `GET`/`POST /droplets/:id/_data` | `{ "data": … }`: the server load only |
| `GET /droplets/:id/client.js`, `/style.css` | That droplet's bundle and styles |
| `GET /index.js`, `/index.css` | The entry client (it defines the element) and the shared stylesheet |
| `ALL /api/*` | Your `+server.ts` endpoints |
| `GET /health` | `ok` |

The browser loads every droplet from where the page loaded `/index.js`. A
host that fetches fragments through an internal address sends the public
location in `x-droplet-location`, so the URLs a fragment writes agree with
it; the droplets server honours it only when its origin is trusted: its own,
`origin`, or `trustedOrigins`. See the
[HTTP contract](https://dropletsjs.dev/integrate/http-contract/) and
[Known hosts](https://dropletsjs.dev/integrate/hosts/overview/): nginx,
Express, React, Astro, SvelteKit, Next.js, FastAPI, Sinatra, PHP, WordPress
and htmx, each a working example in [`examples/hosts`](./examples/hosts).
[Any other stack](https://dropletsjs.dev/integrate/any-stack/) has the two
steps and the exact headers for a stack that is not listed. The
[WordPress tutorial](https://dropletsjs.dev/integrate/wordpress/) puts the
same shop into a WordPress site that owns the data and the login.

## What a droplet can do

- **Any framework**, through [renderers](https://dropletsjs.dev/renderers/):
  droplets in different frameworks share a project and a page.
- **Flags per droplet:** `ssr`, `hydrate` (`true`, `false`, `"visible"`,
  `"interactive"`) and `prerender`; a host overrides hydration per element
  with `data-hydrate`. See [Writing droplets](https://dropletsjs.dev/guides/writing-droplets/).
- **A load chain:** `+droplet.server.ts` on the server, `+droplet.ts` on both
  sides, a Standard Schema for props (zod, valibot…), data that may be a
  promise, and generated `./$types`.
- **Forms:** `actions` with `fail()` and `redirect()`; without JavaScript a
  post answers `303` back to the host page, with JavaScript
  `enhanceDropletForm` shows the result in place.
- **Errors with a place:** `error()` answers like an endpoint; anything else
  goes through `handleError` to the droplet's own `+error.*` page. See
  [Errors](https://dropletsjs.dev/guides/errors/).
- **In the browser:** data inlined into the fragment, host content passed in
  with `<div data-droplet-slot>`, `droplets:stale` when a deploy lands while a
  page is open. See [In the browser](https://dropletsjs.dev/guides/in-the-browser/).
- **Server code:** `handle` in `src/hooks.server.ts`, `+server.ts` endpoints
  under `/api/`, typed environment variables in `src/env.ts`. See
  [Server](https://dropletsjs.dev/guides/server/) and
  [Configuration](https://dropletsjs.dev/guides/configuration/).
- **Deployment:** Node, Cloudflare Workers, Bun or Deno, one adapter each.
  See [Deployment](https://dropletsjs.dev/guides/deployment/).
- **Development:** hot updates on any page that embeds a droplet from
  `vite dev`, and a floating dev tool for host pages. See
  [Development](https://dropletsjs.dev/guides/development/).

## Packages

They all share one version.

| Package | Folder | What it is |
| ------- | ------ | ---------- |
| [`@dropletsjs/droplets`](./packages/droplets) | `packages/droplets` | The core: the Vite plugin, the runtime on Hono, `djs sync` and `djs add` |
| [`@dropletsjs/devtools`](./packages/devtools) | `packages/devtools` | The dev page and the dev tool, in `vite dev` only |
| [`@dropletsjs/adapter-node`](./packages/adapters/node) | `packages/adapters/node` | `dist/server.js` for Node, or a handler to mount in your own server |
| [`@dropletsjs/adapter-cloudflare`](./packages/adapters/cloudflare) | `packages/adapters/cloudflare` | `dist/worker.js` for Cloudflare Workers, assets from Workers Static Assets |
| [`@dropletsjs/adapter-bun`](./packages/adapters/bun) | `packages/adapters/bun` | `dist/server.js` for `bun` |
| [`@dropletsjs/adapter-deno`](./packages/adapters/deno) | `packages/adapters/deno` | `dist/server.js` for `deno serve` |
| [`@dropletsjs/renderer-svelte`](./packages/renderers/svelte) | `packages/renderers/svelte` | Svelte 5: `+droplet.svelte` |
| [`@dropletsjs/renderer-vue`](./packages/renderers/vue) | `packages/renderers/vue` | Vue 3: `+droplet.vue` |
| [`@dropletsjs/renderer-react`](./packages/renderers/react) | `packages/renderers/react` | React 19: `+droplet.tsx` |
| [`@dropletsjs/renderer-preact`](./packages/renderers/preact) | `packages/renderers/preact` | Preact 11: `+droplet.tsx` |
| [`@dropletsjs/renderer-solid`](./packages/renderers/solid) | `packages/renderers/solid` | Solid 1.9: `+droplet.tsx` |
| [`@dropletsjs/renderer-hono-jsx`](./packages/renderers/hono-jsx) | `packages/renderers/hono-jsx` | Hono JSX: `+droplet.tsx` |
| [`@dropletsjs/renderer-handlebars`](./packages/renderers/handlebars) | `packages/renderers/handlebars` | Handlebars 4: `+droplet.hbs`, server-rendered templates |
| [`@dropletsjs/renderer-lit`](./packages/renderers/lit) | `packages/renderers/lit` | Lit 3: `+droplet.lit.ts`, declarative shadow DOM (Lit SSR is labs upstream) |
| [`create-droplets`](./packages/create-droplets) | `packages/create-droplets` | `npm create droplets`: a new project |

## Examples

[`examples/README.md`](./examples/README.md) has the whole list.

- **[`examples/frameworks/<name>`](./examples/frameworks)**: one example per
  framework (svelte, vue, react, preact, solid, hono-jsx, handlebars, lit), each the same
  three droplets (`client`, `ssr-hydrate`, `ssr-nohydrate`) with loads,
  endpoints, an error page and env. `pnpm dev` runs the Svelte one.
- **[`examples/shop`](./examples/shop)**: a shop in six frameworks on SQLite:
  nine droplets, form actions, a login, an admin.
  [`CONTRACT.md`](./examples/shop/CONTRACT.md) says what a host passes each.
- **[`examples/wp-shop`](./examples/wp-shop)**: the shop's droplets backed by
  WordPress: products and reviews over the REST API, the WordPress login.
- **[`examples/hosts/<stack>`](./examples/hosts)**: eleven host examples,
  each a Docker Compose project; nine run the shop demo (on `/gallery`, the
  Svelte example on `/`), WordPress and htmx have flows of their own:

| Host | Stack | Pattern |
| ---- | ----- | ------- |
| [nginx](./examples/hosts/nginx) | nginx, no application code | Server Side Includes + reverse proxy; an IIS `web.config` as reference |
| [express](./examples/hosts/express) | Node, Express 5 | Fetch in a route, or mount the droplets server inside Express |
| [react-vite](./examples/hosts/react-vite) | React 19, Vite | A `<Droplet>` component for single-page apps |
| [astro](./examples/hosts/astro) | Astro | Fetch in the frontmatter, `set:html` |
| [sveltekit](./examples/hosts/sveltekit) | SvelteKit | Fetch in `+page.server.ts`, `{@html}` |
| [nextjs](./examples/hosts/nextjs) | Next.js App Router | Fetch in a server component |
| [fastapi](./examples/hosts/fastapi) | Python, FastAPI, Jinja2 | Fetch with `httpx` |
| [sinatra](./examples/hosts/sinatra) | Ruby, Sinatra, ERB | Fetch with `Net::HTTP` |
| [php](./examples/hosts/php) | PHP 8.3, Apache | `curl_multi`, no framework, no Composer |
| [wordpress](./examples/hosts/wordpress) | WordPress 6 | A `[droplet]` shortcode plugin; serves wp-shop |
| [htmx](./examples/hosts/htmx) | htmx 2, static pages on nginx | `hx-get` swaps the fragment in, cross-origin or proxied |

The [shop demo](https://dropletsjs.dev/integrate/hosts/shop-demo/) page shows
the nine that run it, each recorded end to end.

## Repository map

```
packages/droplets/        the core: Vite plugin, runtime, djs CLI
packages/devtools/        the dev page and the dev tool
packages/adapters/*/      node, cloudflare, bun, deno
packages/renderers/*/     svelte, vue, react, preact, solid, hono-jsx, handlebars, lit
packages/create-droplets/ npm create droplets
examples/frameworks/*/    one example per framework (+ the Dockerfile the hosts build)
examples/shop/            the shop, in six frameworks
examples/wp-shop/         the shop's droplets on WordPress
examples/hosts/*/         eleven host examples (not in the pnpm workspace)
tests/                    end-to-end tests across packages (tests/README.md); each package's own are in its test/
tests/examples/           the eight framework examples in a browser (Playwright)
tests/hosts/              the shop flow on every host's compose stack, recorded
tests/create-droplets/    npm create droplets end to end
tests/djs-add/            djs add end to end
tests/dev-mixed/          React, Vue and Solid under vite dev, HMR in a browser
apps/docs/                dropletsjs.dev (Astro Starlight), a host of live droplets
apps/demo/                the droplets the docs embed live (demo.dropletsjs.dev); not under examples/:
                          it is deployed with the docs and trusts only the docs' origins
DESIGN.md                 design decisions, as they were taken
```

## Developing

```bash
git clone https://github.com/dropletsjs/droplets droplets && cd droplets
pnpm install
pnpm build          # compile every package and run its unit tests
pnpm dev            # the Svelte example on http://localhost:5173 (pnpm dev:shop: the shop)
pnpm check          # build, typecheck, tests/*, build every example for Node and Workers, test the shops and apps/demo
pnpm test:e2e       # the framework examples in Chromium
pnpm test:hosts     # the shop on every host stack (Docker)
pnpm docs:dev       # the docs on http://localhost:4321, with apps/demo beside them
pnpm docs:build     # the static docs, built against a local apps/demo server
```

Node 22 or newer and pnpm 10. [CONTRIBUTING.md](./CONTRIBUTING.md) has the
layout, the checks and what a good pull request looks like;
[`.changeset/`](./.changeset) how releases are versioned.

## Security

A droplets server renders inside pages it does not own: it trusts
`x-droplet-location` only for its own origin or one in `origin` or
`trustedOrigins`, runs a droplet's props schema before
any of its loads, keeps `*.server.*` files and `server/` folders out of every
client bundle, and signs form results it sends back through the host page.
The [Security model](https://dropletsjs.dev/guides/security/) has the rules
for hosts and droplets. Please report vulnerabilities privately, through
[GitHub's security advisories](https://github.com/dropletsjs/droplets/security/advisories/new),
not in a public issue; [SECURITY.md](./SECURITY.md) has the details.

## License

[MIT](./LICENSE)
