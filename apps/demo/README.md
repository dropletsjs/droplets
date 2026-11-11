# Demo droplets

The droplets the docs embed live, served at https://demo.dropletsjs.dev. One
server, every renderer, rendered in `<djs-demo>`; it trusts only the docs'
origins.

```bash
pnpm --filter @dropletsjs/demo dev                # http://localhost:5180, the devtools page
pnpm --filter @dropletsjs/demo build              # dist/server.js for Node
pnpm --filter @dropletsjs/demo start              # http://localhost:8790
pnpm --filter @dropletsjs/demo build:cloudflare   # dist/worker.js for the Worker
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

A docs page can only embed a droplet that exists here. The renderer pages
show the counters' source files as they are here
(`../docs/src/components/RendererDemo.astro` reads them at build), so an edit
here changes the page. Code shared between droplets lives in `src/lib/` and
is framework-agnostic.

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
- the Worker reads it from a Worker secret: `wrangler secret put DROPLETS_SECRET`.

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
pnpm --filter @dropletsjs/demo build:cloudflare
cd apps/demo
npx wrangler secret put DROPLETS_SECRET   # once: openssl rand -base64 32
npx wrangler deploy
```

`wrangler.jsonc` sets no `run_worker_first`: static assets answer the
build's files (`/index.js`, `/assets/*`, each droplet's `client.js` and
`style.css`) before the Worker runs, with the CORS and cache headers of the
`dist/client/_headers` the Cloudflare adapter writes. A path that is no file
(renders, `_data`, the poll's action, `/health`) reaches the Worker, which
allows only the docs' origins. `/droplets.json` is never uploaded
(`.assetsignore`, written by the adapter). `test/worker.test.ts` checks
both under `wrangler dev`, and that nothing server-only is reachable.

Every build has a new build hash, and a page only hydrates fragments of the
build its `/index.js` comes from. The docs inline fragments at their build,
so after a demo deploy, build and deploy the docs against it
([apps/docs](../docs/README.md#deploying)).

## Facts

- Demo element: every droplet renders in `<djs-demo>`. `droplets.config.ts:6`
- Demo CORS: only `docsOrigins()`, preflight kept for a day (`maxAge: 86_400`). `droplets.config.ts:14`
- Demo `trustedOrigins` is `docsOrigins()`: only the docs' pages may post forms and receive Post/Redirect/Get. `droplets.config.ts:22`
- Demo limits: JSON 16 KB, form 4 KB, multipart 8 KB, props 1024 bytes. `droplets.config.ts:25`
- Demo dev server port 5180, production server port 8790. `droplets.config.ts:27`, `droplets.config.ts:28`
- `DOCS_ORIGINS`: `https://dropletsjs.dev`, `http://localhost:4321`, `http://127.0.0.1:4321`. `src/lib/origins.ts:6`
- `DOCS_PORT` between 1024 and 65535 (not 4321) adds `http://localhost:<port>` and `http://127.0.0.1:<port>`; any other value is ignored. `src/lib/origins.ts:19`, `src/lib/origins.ts:20`
- `DOCS_PORT` is set only by the docs' dev script. `../docs/scripts/dev.mjs:37`
- Adapter: `DROPLETS_ADAPTER=cloudflare` builds for Cloudflare, anything else for Node. `vite.config.ts:18`
- Renderers: Svelte, React, Vue, Solid, Preact, Hono JSX, Handlebars, Lit. `vite.config.ts:26`
- CSS: Tailwind is off; `src/app.css` is plain CSS scoped to `<djs-demo>`. `vite.config.ts:28`
- Devtools: `dropletsDevtools()` from `@dropletsjs/devtools` is in the plugins. `vite.config.ts:30`
- Script `dev` runs `scripts/dev-secret.mjs`, then `vite`. `package.json:9`
- Script `build:cloudflare` is `DROPLETS_ADAPTER=cloudflare vite build`. `package.json:11`
- Script `start` runs `dist/server.js` with `.env.local` if it exists. `package.json:14`
- Script `typecheck` runs `djs sync`, `vue-tsc` and `svelte-check --fail-on-warnings`. `package.json:17`
- Script `test` is `vitest run`. `package.json:18`
- Root `pnpm check` runs `build:demo` then `test:demo`. `../../package.json:28`
- `dev-secret.mjs` writes a random `DROPLETS_SECRET` to `.env.local` (mode 0600) when there is none of at least 32 characters. `scripts/dev-secret.mjs:10`, `scripts/dev-secret.mjs:12`
- `.env.local` is gitignored. `../../.gitignore:28`
- Worker name `dropletsjs-demo`, entry `dist/worker.js`. `wrangler.jsonc:7`, `wrangler.jsonc:8`
- Worker uses `nodejs_compat` (Svelte's server renderer needs `node:async_hooks`). `wrangler.jsonc:11`
- Worker assets: `dist/client` through the `ASSETS` binding. `wrangler.jsonc:13`, `wrangler.jsonc:14`
- Worker sets no `run_worker_first`: static assets answer the build's files with `_headers` (`Access-Control-Allow-Origin: *`), the rest reaches the Worker. `wrangler.jsonc:12`, `test/worker.test.ts:108`, `test/worker.test.ts:112`, `test/worker.test.ts:134`
- Worker runs only on the custom domain `demo.dropletsjs.dev`; no `*.workers.dev` or preview URLs. `wrangler.jsonc:17`, `wrangler.jsonc:18`, `wrangler.jsonc:19`
- Cloudflare adapter warns, never fails, when `run_worker_first` sends the build's files through the Worker. `../../packages/adapters/cloudflare/src/index.ts:253`
- Cloudflare adapter writes `client/.assetsignore` with `/droplets.json` and `/.vite/`. `../../packages/adapters/cloudflare/src/index.ts:15`, `../../packages/adapters/cloudflare/src/index.ts:211`
- `/health` is the framework's default health route. `../../packages/droplets/src/core/config.ts:191`
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
- Tests: `test/**/*.test.ts`, one file at a time (`fileParallelism: false`). `vitest.config.ts:7`, `vitest.config.ts:12`
- `server.test.ts` fails without `dist/server.js`: run `pnpm build` first. `test/server.test.ts:18`
- `server.test.ts` covers the droplets, every renderer's counter, and props refused before a load. `test/server.test.ts:81`, `test/server.test.ts:148`, `test/server.test.ts:186`
- `server.test.ts` covers the poll's action: stateless, Post/Redirect/Get, plain data only, code resolved before the body, size limits, who may post. `test/server.test.ts:200`, `test/server.test.ts:221`, `test/server.test.ts:232`, `test/server.test.ts:244`, `test/server.test.ts:288`, `test/server.test.ts:329`, `test/server.test.ts:364`
- `server.test.ts` covers CORS, the droplet location, and server-only code never in a client bundle. `test/server.test.ts:389`, `test/server.test.ts:415`, `test/server.test.ts:429`
- `worker.test.ts` builds with `DROPLETS_ADAPTER=cloudflare` into `dist-worker/` and runs `wrangler dev` on it. `test/worker.test.ts:57`, `test/worker.test.ts:59`, `test/worker.test.ts:69`
- `worker.test.ts` uses `wrangler.jsonc` without `routes`, pointed at its build. `test/worker.test.ts:44`, `test/worker.test.ts:48`, `test/worker.test.ts:49`
- `worker.test.ts` covers the build's files from static assets with `_headers`, the rest from the Worker, other origins refused, nothing server-only served or uploaded. `test/worker.test.ts:107`, `test/worker.test.ts:146`, `test/worker.test.ts:184`, `test/worker.test.ts:195`, `test/worker.test.ts:213`
- `origins.test.ts` covers `docsOrigins()`. `test/origins.test.ts:4`
