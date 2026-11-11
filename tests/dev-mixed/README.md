# tests/dev-mixed

Every renderer in one project, under `vite dev` and in a production build, as
a user runs it. `test/dev.test.ts` checks that each droplet renders,
hydrates on a host page of another origin and takes edits through its
framework's HMR without a reload; `test/production.test.ts` checks that none
of that dev code reaches a `vite build` for Node or Cloudflare Workers.

```bash
pnpm build                                        # the packages' dist/ first
pnpm --filter @dropletsjs/tests-dev-mixed test    # this suite
pnpm test:integration                             # every tests/* suite
```

## Details

### What it needs

- Every package built: the fixture imports `@dropletsjs/*` from their
  `dist/` (`pnpm build`, or `pnpm build:dist` to skip the unit tests).
- Chromium for Playwright (`pnpm --filter @dropletsjs/tests-dev-mixed exec
  playwright install chromium`): `test/dev.test.ts` launches it.
- Ports 5191 (the Vite dev server) and 5192 (the host page) free on
  `localhost`.

### The fixture

`test/fixture` is one project with React, Preact, Vue, Solid, Svelte, Lit,
Hono JSX, Handlebars, a script droplet and a `contract` droplet (React, its
`ssr`/`hydrate`/`prerender` flags edited by the test). React, Preact, Solid
and Hono JSX share `.tsx`; each droplet picks its runtime with
`@jsxImportSource`. Each test copies the fixture to `.tmp/` (gitignored)
and edits the copy, never the fixture.

### `test/dev.test.ts`: `vite dev`

Starts `vite --strictPort` in `.tmp/project` and a host page on another
origin that inlines every fragment and loads `/index.js`. A `window` marker
set after load proves no edit reloaded the page. Under the default
`dev.strategy: "hmr"`:

- Every droplet answers 200; only React's modules carry `$RefreshReg$` and
  `$RefreshSig$`, only Preact's carry `__PREFRESH__` (the regression: React's
  refresh in Vite's shared `oxc` options signed a Vue composable and every
  droplet answered 500).
- A component edit keeps the count in React, Preact and Vue (a Vue
  composable's edit included). Svelte and Solid swap in place with their own
  HMR; their count starts over. Lit and Hono JSX remount in place. Handlebars
  fetches its fragment again. A script droplet runs its cleanup, then its
  function again on the same element.
- A load edit brings new data and keeps the count: the server load for
  React, Preact, Vue, Solid, Lit and Hono JSX, the universal load for
  Svelte. No fragment is asked for again.
- Render contract: `hydrate` false to true hydrates live; every other change
  leaves the droplet as it is and shows a notice (`status`, or `alertdialog`
  with Reload page) in core's toast, or in the dev tool when it is on the
  page.
- `index.js?strategy=remount` remounts from a fresh fragment.

### `test/production.test.ts`: `vite build`

Builds the fixture twice with a recorder plugin that writes, per Vite
environment, the code each chunk renders of each module:

- Node (`.tmp/production-node`): no `DEV_MARKERS` entry in any emitted
  JavaScript, no `update` export in a droplet's `client.js`, no code of a dev
  module (`dev-element`, `dev-notify`, `dev-contract`, `dev-tool`,
  `client-dev`, the devtools) in any chunk, and no file with `dev` in its
  name in `dist/`.
- Cloudflare Workers (`.tmp/production-cloudflare`, `DROPLETS_ADAPTER=cloudflare`):
  `worker.js` is the only server file; no `process.env.NODE_ENV` left, no
  `*.development.js` module, no `jsxDEV` (Hono's modules excepted),
  `react-stack-bottom-frame` or `[Vue warn]`, no dev marker; every
  framework's droplet answers 200 from it.

### Changing it

Dev code added to a package needs a marker in `DEV_MARKERS`: a string or
pattern only that dev code holds. A new dev module's file name goes in
`DEV_MODULE`. A new renderer goes into the fixture, `vite.config.ts` and the
droplet lists of both tests.

## Facts

- `DEV_MARKERS` lists the text only HMR or `vite dev` code holds. `test/production.test.ts:22`
- `DEV_MARKERS` is checked in every emitted `.js`/`.mjs` file of the Node build. `test/production.test.ts:158`
- `DEV_MARKERS` is checked in the Cloudflare `worker.js`. `test/production.test.ts:220`
- `DEV_MODULE` matches the dev modules by file name: `dev-element`, `dev-notify`, `dev-contract`, `dev-tool`, `client-dev`, `devtools/`. `test/production.test.ts:60`
- Dev module code rendered into any chunk of any environment fails the production test. `test/production.test.ts:180`
- Production `dist/` holds no file with `dev` in its name (case-insensitive). `test/production.test.ts:190`
- Droplet `client.js` in production exports no `update` hook. `test/production.test.ts:170`
- Production build runs `vite build` with `NODE_ENV` removed, since vitest's `NODE_ENV=test` builds for development. `test/production.test.ts:108`
- Production build recorder plugin writes `rendered-<environment>.json` per Vite environment. `test/production.test.ts:89`
- Node production build has the environments `client`, `server` and `ssr`. `test/production.test.ts:137`
- Cloudflare production build has the environments `client` and `server`; `worker.js` is the only file outside `client/`. `test/production.test.ts:199`
- Cloudflare `worker.js` contains no `process.env.NODE_ENV`. `test/production.test.ts:203`
- Cloudflare `worker.js` bundles no `*.development.js` module and none of `jsxDEV`, `react-stack-bottom-frame`, `[Vue warn]`. `test/production.test.ts:63`, `test/production.test.ts:211`
- Hono modules are exempt from the `jsxDEV` check: Hono's JSX runtime is named `jsxDEV` in production too. `test/production.test.ts:69`
- Cloudflare `worker.js` renders the React, Preact, Vue, Solid, Svelte, Lit and Hono JSX droplets with 200; Handlebars is not in that list. `test/production.test.ts:230`
- Production builds are copied to `.tmp/production-node` and `.tmp/production-cloudflare`. `test/production.test.ts:106`
- Fixture adapter is Cloudflare when `DROPLETS_ADAPTER=cloudflare`, Node otherwise. `test/fixture/vite.config.ts:19`
- Fixture registers every renderer and `dropletsDevtools()`. `test/fixture/vite.config.ts:23`
- Fixture element is `djs-mixed`, `cors: true`, `trustedOrigins` holds the host page `http://localhost:5192`. `test/fixture/droplets.config.ts:2`
- Fixture dev server port is 5191. `test/fixture/droplets.config.ts:6`
- Dev test runs `vite --strictPort` in `.tmp/project`, a copy of the fixture. `test/dev.test.ts:134`
- Dev test host page listens on `localhost:5192` and loads `/index.js` with the page's query. `test/dev.test.ts:78`, `test/dev.test.ts:142`
- Dev test droplets: `react-hello`, `preact-hello`, `vue-hello`, `solid-hello`, `svelte-hello`, `lit-hello`, `hono-hello`, `hbs-hello`, `script-hello`, `contract`. `test/dev.test.ts:36`
- Dev test fragment requests send `x-droplet-location` set to the host page. `test/dev.test.ts:56`
- Dev test no-reload check: a `window.loaded` marker set after load must survive every edit. `test/dev.test.ts:112`, `test/dev.test.ts:117`
- Dev test uses Chromium through `@playwright/test`. `test/dev.test.ts:143`
- Dev test warms up once so Vite's dependency optimization reload happens before the tests. `test/dev.test.ts:144`
- `$RefreshSig$`/`$RefreshReg$` only in React modules, `__PREFRESH__` only in Preact modules under `vite dev`. `test/dev.test.ts:173`
- React, Preact and Vue keep the count through a component edit. `test/dev.test.ts:204`
- Svelte and Solid swap in place; their count starts over and no fragment is fetched again. `test/dev.test.ts:245`
- Lit and Hono JSX remount and log `<id>: no HMR of its framework took this edit; remounted in place`. `test/dev.test.ts:291`, `test/dev.test.ts:319`
- Handlebars edit fetches the fragment again (`POST /droplets/hbs-hello`). `test/dev.test.ts:328`
- Script droplet edit runs the cleanup, then the function again on the same element. `test/dev.test.ts:338`
- Load edit updates data and keeps the count without a fragment request. `test/dev.test.ts:358`
- Render contract `hydrate` false to true hydrates live, with a `status` toast and no Reload button. `test/dev.test.ts:389`
- Render contract `hydrate` on to false and `ssr` false to true show an `alertdialog` toast with Reload page. `test/dev.test.ts:406`, `test/dev.test.ts:421`
- Render contract toasts: never more than three at once; a newer notice for the same flag replaces the older. `test/dev.test.ts:425`, `test/dev.test.ts:437`
- Render contract notice goes to the dev tool, not a toast, with `?injectTool=true`. `test/dev.test.ts:449`
- `index.js?strategy=remount` remounts React from a fresh fragment. `test/dev.test.ts:463`
- `dev.strategy` defaults to `"hmr"`. `../../packages/droplets/src/core/config.ts:381`
- Test timeout 60 s, hook timeout 120 s. `vitest.config.ts:7`
- Test script is `vitest run`. `package.json:9`
- `.tmp/` is gitignored. `../../.gitignore:44`
