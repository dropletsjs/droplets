# Demo droplets

The droplets the docs embed live, served at https://demo.dropletsjs.dev. One
server, every renderer, rendered in `<djs-demo>`; it trusts only the docs'
origins.

```bash
pnpm --filter @dropletsjs/demo dev                # http://localhost:5180, the devtools page
pnpm --filter @dropletsjs/demo build              # dist/server.js for Node, then the exported testimonials pages
pnpm --filter @dropletsjs/demo start              # http://localhost:8790
pnpm --filter @dropletsjs/demo build:cloudflare   # dist/worker.js for the Worker, then the same pages
pnpm --filter @dropletsjs/demo test               # needs the Node build; builds the Worker itself
```

## Details

### The droplets

| Droplet | Framework | Shows |
| --- | --- | --- |
| `hello` | Svelte | a server `load` that greets `who` from the props; rendered on the server, then hydrated |
| `counter` | React | interactivity after hydration; no server load, its props are all it needs |
| `poll` | Vue | a form action, enhanced: `?/vote` checks the answer, `fail()`s with a code, echoes the vote. Stateless: nothing is stored, counted or shared between visitors |
| `crash` | Solid | `?fail=1` (or `{ "fail": true }`) makes the load throw; `handleError` and `+error.tsx` render inside the same element |
| `counter-svelte`, `counter-vue`, `counter-react`, `counter-preact`, `counter-solid`, `counter-hono-jsx`, `counter-lit` | one each | the renderer pages' droplet, the same in each: a server load returns `{ framework, start: 3 }`, the server renders it, the browser hydrates it and a button adds one |
| `counter-handlebars` | Handlebars | the same card, server HTML only (`hydrate = false`): a template has no code in the browser |
| `counter-script` | plain script | the same counter built in the browser from the load's data; the server sends an empty element |
| `testimonials-client-only` | Svelte | `ssr = false`, `hydrate = true`: a universal load in the browser reads IndexedDB, else fetches ten random testimonials from the API on the droplet location and keeps them; Refresh clears IndexedDB and fetches again |
| `testimonials-server-client` | Svelte | `ssr = true`, `hydrate = true`: the server load asks `event.fetch("/api/testimonials?max=10&random=true")`, answered in-process; Refresh fetches ten more from the API in the browser |
| `testimonials-server-only` | Svelte | `ssr = true`, `hydrate = false`: the same server load, HTML only, no button |
| `testimonials-prerender-only` | Svelte | `ssr = false`, `hydrate = false`, `prerender = true`: pages 1 to 10 rendered at build from the data module (`entries`); any other page answers 404 |
| `testimonials-none` | Svelte | all three flags off: the fragment is an empty element |

A docs page can only embed a droplet that exists here. The renderer pages
show the counters' source files as they are here
(`../docs/src/components/RendererDemo.astro` reads them at build), so an edit
here changes the page. Code shared between droplets lives in `src/lib/` and
is framework-agnostic, but for `src/lib/Testimonials.svelte`, the list the
five Svelte testimonials droplets share.

### The testimonials

`GET /api/testimonials` (`src/api/testimonials/+server.ts`) answers from
`src/lib/server/testimonials.json`, 100 fictional sample testimonials
`{ id, author, text }`:

- `?max=N&random=true`: `{ testimonials }`, N random distinct items, N from
  1 to 100, 10 without `max`; `no-store`.
- `?page=P`: `{ page, pages, testimonials }`, ten per page in id order, P
  from 1 to 10; cached five minutes.
- Anything else, an unknown or repeated key included, is a 400
  `{ "message": … }`. The query is read key by key from `URLSearchParams`
  against a fixed list and merged into nothing.

The Writing droplets guide shows the five droplets side by side
(`../docs/src/components/DropletExamples.astro`).

### Exported pages

The prerendered renders are private to the server. `pnpm build` and
`pnpm build:cloudflare` run `scripts/export-testimonials.mjs` after
`vite build`: it asks the build itself (`dist/server.js`, or `dist/worker.js`
in Node with an `ASSETS` binding that reads `dist/client`) for
`/droplets/testimonials-prerender-only?page=1` to `10` and writes each answer
to `dist/client/assets/public/testimonials/page-<n>.html`. Cloudflare serves
them as static assets, without a Worker invocation; the Node server serves
them under `/assets/public/`. Both tests check each file is byte-equal to the
route's answer.

`pnpm docs:dev` at the root runs this dev server next to the docs, and
`pnpm docs:build` builds and starts the Node server to fetch the fragments it
inlines ([apps/docs](../docs/README.md)).

### Who may embed it

`droplets.config.ts` allows exactly the docs' origins (`src/lib/origins.ts`:
https://dropletsjs.dev and the docs' local dev server on port 4321, on
`localhost` and `127.0.0.1`), for CORS and for form posts (`trustedOrigins`).
Every other origin gets no CORS answer and a `403` for a form post.
`pnpm docs:dev --port 4400` starts this dev server with `DOCS_PORT=4400`,
which adds that port's `localhost` and `127.0.0.1` origins; nothing else sets
it.

### Location and host, fixed

`droplets.config.ts` sets `location: "https://demo.dropletsjs.dev"` and
`host: "https://dropletsjs.dev"`. `vite build` writes both into the server
bundle: every URL a fragment writes is on `https://demo.dropletsjs.dev`
wherever the server runs, no location header is read, and no answer is
rewritten (the build holds no token). `event.host` is
`https://dropletsjs.dev` plus the reported page's path when that page is on
it. The docs build runs the demo on `127.0.0.1` and needs to pass nothing
about the location.

`vite dev` ignores both and computes them per request, so `pnpm docs:dev`
works on `localhost`. `pnpm start`, `vite preview` and `wrangler dev` serve
the build: the URLs they write (`/index.js` aside, which the page names
itself) are on `https://demo.dropletsjs.dev`, so a page under them loads the
droplets' bundles and stylesheets from the deployed demo.

### The poll's input

The poll's action reads one field, `answer`, as a string of at most ten
characters (the longest answer id) and looks it up in a `Map`; the framework
resolves the droplet and the action before the body is read, and the bodies
are limited to a few kilobytes (`limits` in `droplets.config.ts`).
`test/server.test.ts` has a negative test for each of these.

### Secrets

`DROPLETS_SECRET` signs the result of a vote posted without JavaScript
(Post/Redirect/Get). It is never committed:

- locally, `pnpm dev` writes a random one to `.env.local` (gitignored) the
  first time, and `pnpm start` reads it from there;
- the docs build generates one per run for the server it starts;
- the Worker reads it from a Worker secret, uploaded with the first deploy
  and rotated with `wrangler secret put DROPLETS_SECRET` ([Deploying](#deploying)).

### Tests

- `test/server.test.ts` drives the built `dist/server.js` through its fetch
  handler: run `pnpm build` first (the root `pnpm check` does).
- `test/worker.test.ts` builds the Worker into `dist-worker/` and runs it
  under `wrangler dev` (local, no account) with the assets config of
  `wrangler.jsonc`, without the custom domain.
- `test/origins.test.ts` covers `docsOrigins()`.

### Deploying

The Worker `dropletsjs-demo` on the custom domain `demo.dropletsjs.dev`
(`wrangler.jsonc`), deployed by hand, never from CI:

```bash
pnpm --filter @dropletsjs/demo deploy:cloudflare   # build:cloudflare, then wrangler deploy
```

Every command runs the `wrangler` the demo declares, from `apps/demo`; never
`npx wrangler`. The secret is random, at least 32 bytes
(`openssl rand -base64 48`). The first deploy uploads it with the Worker,
from a temporary JSON file: a `wrangler secret put` before the Worker exists
creates an empty Worker of that name.

```bash
pnpm --filter @dropletsjs/demo build:cloudflare
tmp=$(mktemp)   # mode 0600
printf '{"DROPLETS_SECRET":"%s"}\n' "$(openssl rand -base64 48)" > "$tmp"
pnpm --filter @dropletsjs/demo exec wrangler deploy --secrets-file "$tmp"
rm "$tmp"
```

Later deploys (`deploy:cloudflare`) keep the secret. To rotate it, which
invalidates the vote results already signed:

```bash
openssl rand -base64 48 | pnpm --filter @dropletsjs/demo exec wrangler secret put DROPLETS_SECRET
```

`wrangler.jsonc` sets no `run_worker_first`: static assets answer the
build's files (`/index.js`, `/index.css`, `/assets/*`, each droplet's `client.js` and
`style.css`) before the Worker runs, with the CORS and cache headers of the
`dist/client/_headers` the Cloudflare adapter writes; `html_handling: "none"`
serves the exported `page-<n>.html` as named, never redirected to an
extensionless path. A path that is no file
(renders, `_data`, the poll's action, `/health`) reaches the Worker, which
allows only the docs' origins. `/droplets.json` is never uploaded
(`.assetsignore`, written by the adapter). `test/worker.test.ts` checks
both under `wrangler dev`, and that nothing server-only is reachable.

Search engines may fetch everything here, so Google can render the docs'
live droplets, but index none of it: there is no `robots.txt` that
disallows anything, and every answer carries `X-Robots-Tag: noindex`. The
Worker's answers get it from `handle` in `src/hooks.server.ts`; the build's
files, which `handle` never sees, from the project's own `_headers`, a `/*`
rule the Cloudflare adapter appends after its block in
`dist/client/_headers`. `/health`, and the 404 of a missing build file, are
answered before `handle` and carry no such header.

Every build has a new build hash, and a page only hydrates fragments of the
build its `/index.js` comes from. The docs inline fragments at their build,
so after a demo deploy, build and deploy the docs against it
([apps/docs](../docs/README.md#deploying)).

## Facts

- Demo element: every droplet renders in `<djs-demo>`. `droplets.config.ts:6`
- Demo CORS: only `docsOrigins()`, preflight kept for a day (`maxAge: 86_400`). `droplets.config.ts:14`
- Demo `trustedOrigins` is `docsOrigins()`: only the docs' pages may post forms and receive Post/Redirect/Get. `droplets.config.ts:20`
- Demo `location` is `https://demo.dropletsjs.dev` and `host` is `https://dropletsjs.dev`, both fixed at build; `vite dev` ignores both. `droplets.config.ts:29`, `droplets.config.ts:30`
- The build holds no host or location token (`__$DROPLET_`). `test/server.test.ts:436`
- Demo limits: JSON 16 KB, form 4 KB, multipart 8 KB, props 1024 bytes. `droplets.config.ts:33`
- Demo dev server port 5180, production server port 8790. `droplets.config.ts:35`, `droplets.config.ts:36`
- `DOCS_ORIGINS`: `https://dropletsjs.dev`, `http://localhost:4321`, `http://127.0.0.1:4321`. `src/lib/origins.ts:6`
- `DOCS_PORT` between 1024 and 65535 (not 4321) adds `http://localhost:<port>` and `http://127.0.0.1:<port>`; any other value is ignored. `src/lib/origins.ts:19`, `src/lib/origins.ts:20`
- `DOCS_PORT` is set only by the docs' dev script. `../docs/scripts/dev.mjs:37`
- Adapter: `DROPLETS_ADAPTER=cloudflare` builds for Cloudflare, anything else for Node. `vite.config.ts:18`
- Renderers: Svelte, React, Vue, Solid, Preact, Hono JSX, Handlebars, Lit. `vite.config.ts:26`
- CSS: Tailwind is off; `src/app.css` is plain CSS scoped to `<djs-demo>`. `vite.config.ts:28`
- Devtools: `dropletsDevtools()` from `@dropletsjs/devtools` is in the plugins. `vite.config.ts:30`
- Script `dev` runs `scripts/dev-secret.mjs`, then `vite`. `package.json:9`
- Script `build` is `vite build`, then `scripts/export-testimonials.mjs`. `package.json:10`
- Script `build:cloudflare` is `DROPLETS_ADAPTER=cloudflare vite build`, then `scripts/export-testimonials.mjs`. `package.json:11`
- Script `deploy:cloudflare` is `build:cloudflare`, then `wrangler deploy`. `package.json:13`
- `wrangler` is a dev dependency at the catalog's range; the deploy and secret commands run it through pnpm, never `npx`. `package.json:54`, `../../pnpm-workspace.yaml:32`
- Script `start` runs `dist/server.js` with `.env.local` if it exists. `package.json:14`
- Script `typecheck` runs `djs sync`, `vue-tsc` and `svelte-check --fail-on-warnings`. `package.json:17`
- Script `test` is `vitest run`. `package.json:18`
- Root `pnpm check` runs `build:demo` then `test:demo`. `../../package.json:28`
- `dev-secret.mjs` writes a random `DROPLETS_SECRET` to `.env.local` (mode 0600) when there is none of at least 32 characters. `scripts/dev-secret.mjs:10`, `scripts/dev-secret.mjs:12`
- `.env.local` is gitignored. `../../.gitignore:28`
- Worker name `dropletsjs-demo`, entry `dist/worker.js`. `wrangler.jsonc:7`, `wrangler.jsonc:8`
- Worker uses `nodejs_compat`: Svelte's server renderer and the request store (`AsyncLocalStorage`) need `node:async_hooks`. `wrangler.jsonc:11`
- Worker assets: `dist/client` through the `ASSETS` binding. `wrangler.jsonc:13`, `wrangler.jsonc:14`
- Worker sets no `run_worker_first`: static assets answer the build's files with `_headers` (`Access-Control-Allow-Origin: *`), the rest reaches the Worker. `wrangler.jsonc:12`, `test/worker.test.ts:110`, `test/worker.test.ts:114`, `test/worker.test.ts:154`
- Worker assets `html_handling` is `none`: `/assets/public/testimonials/page-1.html` answers 200, not a 307 to `/page-1`. `wrangler.jsonc:17`, `test/worker.test.ts:138`
- `/assets/public/*` gets `Access-Control-Allow-Origin: *` from the adapter's `/assets/*` rule in `_headers`, `Cache-Control: no-cache` from its own. `../../packages/adapters/cloudflare/src/index.ts:103`, `../../packages/adapters/cloudflare/src/index.ts:104`
- `handle` (`src/hooks.server.ts`) sets `x-robots-tag: noindex` on every answer it resolves: renders, `_data`, actions, `/api/*`, errors. `src/hooks.server.ts:11`, `test/server.test.ts:420`
- Root `_headers` gives every static asset `X-Robots-Tag: noindex` (`/*`), appended after the adapter's rules in `dist/client/_headers`. `_headers:3`, `../../packages/adapters/cloudflare/src/index.ts:246`, `test/worker.test.ts:144`
- `/health` and the Worker's 404 for a missing build file are answered before `handle`, without `x-robots-tag`. `../../packages/droplets/src/runtime/app.ts:1061`, `../../packages/droplets/src/runtime/app.ts:1109`
- No `robots.txt`: crawlers may fetch the demo's files to render the docs' live droplets. `test/worker.test.ts:157`
- Worker runs only on the custom domain `demo.dropletsjs.dev`; no `*.workers.dev` or preview URLs. `wrangler.jsonc:20`, `wrangler.jsonc:21`, `wrangler.jsonc:22`
- Cloudflare adapter warns, never fails, when `run_worker_first` sends the build's files through the Worker. `../../packages/adapters/cloudflare/src/index.ts:253`
- Cloudflare adapter writes `client/.assetsignore` with `/droplets.json` and `/.vite/`. `../../packages/adapters/cloudflare/src/index.ts:15`, `../../packages/adapters/cloudflare/src/index.ts:211`
- `/health` is the framework's default health route. `../../packages/droplets/src/core/config.ts:201`
- `hello` props: `who`, trimmed, 1 to 40 characters, default `world`. `src/droplets/hello/+droplet.ts:8`
- `hello` load returns the greeting and `renderedAt`, `cache-control: public, max-age=300`. `src/droplets/hello/+droplet.server.ts:8`, `src/droplets/hello/+droplet.server.ts:9`
- `counter` props: `start`, an integer from -1000 to 1000, default 0; its load is universal, no server file. `src/droplets/counter/+droplet.ts:6`, `src/droplets/counter/+droplet.ts:10`
- `counter` is React. `src/droplets/counter/+droplet.tsx:1`
- `poll` load: the question and answers, `cache-control: public, max-age=300`. `src/droplets/poll/+droplet.server.ts:8`
- `poll` action `vote` reads one field, `answer`. `src/droplets/poll/+droplet.server.ts:19`, `src/droplets/poll/+droplet.server.ts:22`
- `poll` failures: 400 `unreadable` form, 422 `missing` or `unknown` answer; never the submitted value. `src/droplets/poll/+droplet.server.ts:21`, `src/droplets/poll/+droplet.server.ts:23`, `src/droplets/poll/+droplet.server.ts:24`
- `poll` success returns its own id and label, not the submitted string. `src/droplets/poll/+droplet.server.ts:26`
- `poll` answers are a `Map`: svelte, vue, react, solid, hono-jsx, handlebars. `src/lib/poll.ts:8`
- `poll` answer length limit is the longest answer id (10). `src/lib/poll.ts:18`
- `poll` form is enhanced with `useEnhanceDropletForm` from `@dropletsjs/renderer-vue/form`. `src/droplets/poll/+droplet.vue:9`, `src/droplets/poll/+droplet.vue:20`
- Form field reading: a string only (a File is a missing field), trimmed, at most `max` characters. `src/lib/server/forms.ts:15`
- Form body that cannot be read as a form is `null`. `src/lib/server/forms.ts:6`
- `crash` props: `fail`, a boolean or `"0"`, `"1"`, `"false"`, `"true"`, default false. `src/droplets/crash/+droplet.ts:8`
- `crash` load throws when `fail` is `true`, `"1"` or `"true"`. `src/droplets/crash/+droplet.server.ts:6`
- `crash` `handleError` returns a fixed message; the thrown error stays on the server. `src/droplets/crash/+droplet.server.ts:17`
- `crash` error page is `+error.tsx`, Solid. `src/droplets/crash/+error.tsx:1`
- `counter-<renderer>` server loads return `{ framework, start: 3 }`, cached five minutes. `src/droplets/counter-svelte/+droplet.server.ts:10`, `src/droplets/counter-handlebars/+droplet.server.ts:10`, `src/droplets/counter-script/+droplet.server.ts:10`
- `counter-handlebars` has `hydrate = false`. `src/droplets/counter-handlebars/+droplet.hbs:3`
- `counter-script` is a `+droplet.script.ts` that builds its markup in the browser from `data`. `src/droplets/counter-script/+droplet.script.ts:18`
- `counter-lit` is a `DropletElement` from `@dropletsjs/renderer-lit/element`. `src/droplets/counter-lit/+droplet.lit.ts:2`
- `Testimonial` is `{ id, author, text }`, in a neutral module the components import. `src/lib/testimonials.ts:6`
- Testimonials data: 100 items, ids 0 to 99, server only. `src/lib/server/testimonials.json`, `src/lib/testimonials.ts:14`
- `/api/testimonials` answers GET only. `src/api/testimonials/+server.ts:10`
- `/api/testimonials` query keys: `max`, `random`, `page`, each once; any other key, or one twice, is a 400. `src/lib/server/testimonials.ts:21`, `src/lib/server/testimonials.ts:34`, `src/lib/server/testimonials.ts:35`
- `/api/testimonials` integers are `^[1-9][0-9]{0,2}$` within range: `max` 1 to 100, `page` 1 to 10. `src/lib/server/testimonials.ts:22`, `src/lib/server/testimonials.ts:31`
- `?max=N&random=true` answers `{ testimonials }`, N random distinct items, 10 without `max`, `no-store`. `src/lib/server/testimonials.ts:48`, `src/lib/server/testimonials.ts:54`, `src/api/testimonials/+server.ts:16`
- `?page=P` answers `{ page, pages, testimonials }`, ten in id order, `public, max-age=300`. `src/lib/server/testimonials.ts:65`, `src/api/testimonials/+server.ts:14`
- `/api/testimonials` with both modes, `random` other than `true`, or no key answers 400 `{ message }`. `src/lib/server/testimonials.ts:42`, `src/lib/server/testimonials.ts:47`
- `Testimonials.svelte` props: `testimonials`, `onRefresh`; the Refresh button renders only after mount and only with `onRefresh`. `src/lib/Testimonials.svelte:4`, `src/lib/Testimonials.svelte:32`
- Browser fetches of the API go to `droplet.url("/api/testimonials?max=10&random=true")`, on the droplet location. `src/lib/testimonials-api.ts:5`, `src/lib/testimonials.ts:20`
- `testimonials-client-only`: `ssr = false`, `hydrate = true`, `prerender = false`; a universal load only. `src/droplets/testimonials-client-only/+droplet.svelte:2`, `src/droplets/testimonials-client-only/+droplet.ts:9`
- `testimonials-client-only` keeps the last list in IndexedDB `djs-demo-testimonials` (the host page's origin); Refresh clears it, fetches and keeps anew. `src/droplets/testimonials-client-only/store.ts:6`, `src/droplets/testimonials-client-only/store.ts:42`
- `testimonials-server-client`: `ssr = true`, `hydrate = true`; its server load calls `event.fetch("/api/testimonials?max=10&random=true")`. `src/droplets/testimonials-server-client/+droplet.svelte:2`, `src/droplets/testimonials-server-client/+droplet.server.ts:7`
- `testimonials-server-only`: `ssr = true`, `hydrate = false`, the same server load; no bundle served. `src/droplets/testimonials-server-only/+droplet.svelte:3`, `src/droplets/testimonials-server-only/+droplet.server.ts:7`
- `testimonials-prerender-only`: `ssr = false`, `hydrate = false`, `prerender = true`; `entries` are pages 1 to 10; its load reads the data module. `src/droplets/testimonials-prerender-only/+droplet.svelte:2`, `src/droplets/testimonials-prerender-only/+droplet.server.ts:7`, `src/droplets/testimonials-prerender-only/+droplet.server.ts:10`
- `testimonials-prerender-only` props: `page`, an integer 1 to 100 (else 400); a page without an entry answers 404. `src/droplets/testimonials-prerender-only/+droplet.ts:8`, `test/server.test.ts:564`
- `testimonials-none`: all three flags `false`; the fragment is an empty element. `src/droplets/testimonials-none/+droplet.svelte:4`
- `export-testimonials.mjs` asks `dist/server.js`, else `dist/worker.js` with an `ASSETS` stub reading `dist/client`, for `https://demo.dropletsjs.dev/droplets/testimonials-prerender-only?page=<n>`. `scripts/export-testimonials.mjs:38`, `scripts/export-testimonials.mjs:46`, `scripts/export-testimonials.mjs:56`
- `export-testimonials.mjs` writes `dist/client/assets/public/testimonials/page-1.html` to `page-10.html`; a non-200 or non-fragment answer fails it. `scripts/export-testimonials.mjs:59`, `scripts/export-testimonials.mjs:62`
- `export-testimonials.mjs` takes the build directory as its argument, `dist` by default. `scripts/export-testimonials.mjs:21`
- Tests: `test/**/*.test.ts`, one file at a time (`fileParallelism: false`). `vitest.config.ts:7`, `vitest.config.ts:12`
- `server.test.ts` fails without `dist/server.js`: run `pnpm build` first. `test/server.test.ts:20`
- `server.test.ts` covers the droplets, every renderer's counter, and props refused before a load. `test/server.test.ts:82`, `test/server.test.ts:136`, `test/server.test.ts:191`
- `server.test.ts` covers the poll's action: stateless, Post/Redirect/Get, plain data only, code resolved before the body, size limits, who may post. `test/server.test.ts:205`, `test/server.test.ts:226`, `test/server.test.ts:237`, `test/server.test.ts:249`, `test/server.test.ts:293`, `test/server.test.ts:334`, `test/server.test.ts:369`
- `server.test.ts` covers CORS, the fixed droplet location, and server-only code never in a client bundle (the testimonials' texts in no script or stylesheet). `test/server.test.ts:394`, `test/server.test.ts:420`, `test/server.test.ts:603`
- `server.test.ts` covers `/api/testimonials` (both modes, 400s, `__proto__` and odd keys polluting nothing), the five testimonials droplets, and the exported pages byte-equal to the route with the docs' CORS. `test/server.test.ts:445`, `test/server.test.ts:487`, `test/server.test.ts:533`, `test/server.test.ts:586`
- `worker.test.ts` builds with `DROPLETS_ADAPTER=cloudflare` into `dist-worker/` and runs `wrangler dev` on it. `test/worker.test.ts:57`, `test/worker.test.ts:59`, `test/worker.test.ts:75`
- `worker.test.ts` runs `export-testimonials.mjs` on `dist-worker/`. `test/worker.test.ts:63`
- `worker.test.ts` uses `wrangler.jsonc` without `routes`, pointed at its build. `test/worker.test.ts:43`, `test/worker.test.ts:48`, `test/worker.test.ts:49`
- `worker.test.ts` covers the exported pages as static files, `text/html`, byte-equal to the Worker's render, to any origin. `test/worker.test.ts:138`
- `worker.test.ts` covers the build's files from static assets with `_headers`, the rest from the Worker, other origins refused, nothing server-only served or uploaded. `test/worker.test.ts:109`, `test/worker.test.ts:166`, `test/worker.test.ts:204`, `test/worker.test.ts:215`, `test/worker.test.ts:233`
- `origins.test.ts` covers `docsOrigins()`. `test/origins.test.ts:4`
