# Framework examples

One droplets project per renderer: Svelte, Vue, React, Solid, Preact, Lit,
Hono JSX and Handlebars. Each serves the same three droplets, so the eight
differ only in the framework: copy the one for your stack and change the
droplets.

```bash
pnpm --filter @dropletsjs/example-svelte dev     # http://localhost:5173: the devtools page
pnpm --filter @dropletsjs/example-svelte build   # dist/server.js for Node
pnpm --filter @dropletsjs/example-svelte start   # http://localhost:8000
```

Then `http://localhost:8000/droplets/ssr-hydrate?who=Ana` is the fragment a
host pastes into its page. Swap `svelte` for `vue`, `react`, `solid`,
`preact`, `lit`, `hono-jsx` or `handlebars`.

## Details

### The three droplets

| Droplet | Mode |
| ------- | ---- |
| `client` | `ssr = false`: rendered in the browser |
| `ssr-hydrate` | rendered on the server with its load, then hydrated; `+error.*` is its error page |
| `ssr-nohydrate` | `hydrate = false`: server HTML and no JavaScript |

Two examples add one more: Svelte has `page-views`, a script droplet
(`+droplet.script.ts`) that posts each view to `/api/page-views`; Lit has
`guestbook`, a form action in a shadow root. Each example's own `README.md`
describes its files.

### What every example shows

- **loads**: `+droplet.server.ts` (`src/lib/server/facts.ts`) on the server,
  `+droplet.ts` on both sides, behind the props schema in `src/lib/props.ts`;
- **endpoints**: `src/api/*/+server.ts` (a shared counter, the time, a
  greeting, what the private variables tell), called through
  `$droplets/drop` (`src/lib/api.ts`; Handlebars has no client code to call
  them);
- **the error page**: `?who=crash` makes the load throw, and `handleError`
  in `ssr-hydrate/+droplet.server.ts` decides what `+error.*` shows;
- **env**: one variable of each kind in `src/env.ts`, with demo values in
  `.env` (committed: nothing in it is secret);
- **hooks**: `src/hooks.server.ts` puts a request id in `event.locals` and
  answers it as `x-request-id`.

### Scripts

Every example has the same scripts:

| Script | What it does |
| --- | --- |
| `dev` | `vite`: the devtools page on `/`, port 5173 |
| `build` | `vite build` with the Node adapter: `dist/server.js` |
| `build:cloudflare`, `build:bun`, `build:deno` | the same with `DROPLETS_ADAPTER` set: `dist/worker.js` for Workers (`wrangler.jsonc`), `dist/server.js` for Bun or Deno |
| `start`, `start:bun`, `start:deno` | run the build on port 8000 |
| `preview:cloudflare`, `deploy:cloudflare` | `wrangler dev`, `wrangler deploy` |
| `typecheck` | `djs sync`, then the framework's checker |

### Copying an example

Inside this repository the examples take the Droplets packages as
`workspace:*` and the tools from the pnpm `catalog:`. In a copy, replace
both with versions: `@dropletsjs/*@alpha` and the tool ranges in the root
`pnpm-workspace.yaml`. To start from scratch instead, `npm create droplets`
writes a new project (one `hello-<framework>` droplet) with the versions
filled in.

### The Docker image

`Dockerfile` builds one example into a server image, from the repository
root. `EXAMPLE` picks the folder (Svelte by default), which is the image the
[host examples](../hosts) start:

```bash
docker build -f examples/frameworks/Dockerfile -t droplets-svelte .
docker build -f examples/frameworks/Dockerfile --build-arg EXAMPLE=vue -t droplets-vue .
docker run --rm -p 8000:8000 droplets-svelte
```

### Checks

`pnpm build:examples` and `pnpm build:examples:cloudflare` (both in
`pnpm check`) build all eight; `pnpm test:e2e` runs their production builds
in Chromium, each embedded in a host page on another origin
([`tests/examples`](../../tests/examples)).

## Facts

- Framework examples: `svelte`, `vue`, `react`, `solid`, `hono-jsx`, `handlebars`, `preact`, `lit`, the list the e2e run uses. `../../tests/examples/e2e/examples.ts:2`
- Example package names are `@dropletsjs/example-<folder>`. `svelte/package.json:2`
- Custom element per example is `djs-<folder>` (`djs-svelte`, `djs-vue`, …). `svelte/droplets.config.ts:9`, `vue/droplets.config.ts:9`
- Every example sets `cors: true`, so host pages on other origins can import the droplet bundles. `svelte/droplets.config.ts:16`
- Dev server port is 5173 and the production server port 8000 in every example. `svelte/droplets.config.ts:18`, `svelte/droplets.config.ts:19`
- Adapter is picked by `DROPLETS_ADAPTER` (`node`, `cloudflare`, `bun`, `deno`), Node when unset. `svelte/vite.config.ts:13`, `svelte/vite.config.ts:14`
- Tailwind compiles `src/app.css` in every example except Lit (`css: { tailwind: true }`). `svelte/vite.config.ts:25`, `lit/vite.config.ts:21`
- Devtools (`dropletsDevtools()`) are in every example's plugins and serve `/` in `vite dev` only. `svelte/vite.config.ts:27`
- Droplet `client` is `ssr = false`, `hydrate = true`. `svelte/src/droplets/client/+droplet.svelte:4`, `react/src/droplets/client/+droplet.tsx:7`
- Droplet `ssr-hydrate` is `ssr = true`, `hydrate = true`. `svelte/src/droplets/ssr-hydrate/+droplet.svelte:2`, `react/src/droplets/ssr-hydrate/+droplet.tsx:6`
- Droplet `ssr-nohydrate` is `ssr = true`, `hydrate = false`. `svelte/src/droplets/ssr-nohydrate/+droplet.svelte:3`, `react/src/droplets/ssr-nohydrate/+droplet.tsx:6`
- Handlebars flags are written `export ssr = …` in the template. `handlebars/src/droplets/client/+droplet.hbs:2`
- Props schema: `who`, a trimmed string of at most 200 characters, default `world`. `svelte/src/lib/props.ts:11`
- Server load answers 404 for a `who` longer than 40 characters. `svelte/src/lib/server/facts.ts:21`
- Server load throws for `who=crash`, which renders the error page. `svelte/src/lib/server/facts.ts:23`
- Error page content comes from `handleError` in `ssr-hydrate/+droplet.server.ts`; the original error stays on the server. `svelte/src/droplets/ssr-hydrate/+droplet.server.ts:10`
- Counter is one in-memory value per server process, shared by every droplet. `svelte/src/lib/server/counter.ts:6`
- `POST /api/counter` adds `by` when it is an integer within ±100, else 1. `svelte/src/api/counter/+server.ts:10`
- `GET /api/env` answers what the private variables tell, never their values. `svelte/src/api/env/+server.ts:5`, `svelte/src/lib/server/facts.ts:8`
- `GET /api/greet/<name>` answers 400 for a name longer than 40 characters. `svelte/src/api/greet/[name]/+server.ts:5`
- `$droplets/drop` `droplet.url(path)` points API calls at the droplets server, not the host page. `svelte/src/lib/api.ts:10`
- Env variables: `API_TOKEN` private runtime, `BUILD_CHANNEL` private static, `PUBLIC_SITE_NAME` public static, `PUBLIC_BANNER` public runtime. `svelte/src/env.ts:9`
- `.env` holds demo values for `PUBLIC_SITE_NAME`, `PUBLIC_BANNER` and `BUILD_CHANNEL`, no secret. `svelte/.env:5`
- `handle` hook sets `event.locals.requestId` (8 characters) and the `x-request-id` response header. `svelte/src/hooks.server.ts:15`, `svelte/src/hooks.server.ts:19`
- Svelte example adds the `page-views` script droplet, its props a slug `page` defaulting to `home`. `svelte/src/droplets/page-views/+droplet.ts:9`
- `POST /api/page-views` takes `application/json` only (415), at most 256 bytes (413), one own `page` slug (400). `svelte/src/api/page-views/+server.ts:27`, `svelte/src/api/page-views/+server.ts:31`, `svelte/src/api/page-views/+server.ts:42`
- Lit example adds `guestbook`, a default form action that answers `fail(422)` without a name. `lit/src/droplets/guestbook/+droplet.server.ts:8`
- Wrangler config: `main` is `dist/worker.js`, `nodejs_compat` on, the `ASSETS` binding over `dist/client` with `run_worker_first: true`. `svelte/wrangler.jsonc:4`, `svelte/wrangler.jsonc:7`, `svelte/wrangler.jsonc:12`
- `typecheck` runs `djs sync` first; Svelte uses `svelte-check`, Vue `vue-tsc`, the others `tsc`. `svelte/package.json:22`, `vue/package.json:22`, `react/package.json:22`
- Droplets packages are `workspace:*` dependencies inside the repository. `svelte/package.json:25`
- Dockerfile builds the example named by `EXAMPLE`, `svelte` by default. `Dockerfile:24`
- Dockerfile compiles the packages with `build:dist` (no unit tests) before the example's `build`. `Dockerfile:35`
- Docker image runs `node dist/server.js` as user `node` on port 8000. `Dockerfile:45`, `Dockerfile:46`, `Dockerfile:47`
- Host examples build their droplets server from this Dockerfile. `../hosts/astro/docker-compose.yml:9`
- e2e run serves each example's build on its own port, 8400 and up, embedded from a host page on 8100. `../../tests/examples/e2e/examples.ts:7`, `../../tests/examples/e2e/examples.ts:10`
