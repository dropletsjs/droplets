# tests/examples

The eight examples in [`examples/frameworks`](../../examples/frameworks), end
to end in Chromium, against their production builds. Playwright starts each
example's built server and one host page on another origin
(`e2e/host.mjs`) that fetches the fragments on the server and loads
`/index.js`, as a real host does.

```bash
pnpm build                                                   # the packages' dist/ first
pnpm test:e2e                                                # build the examples, then run every project
pnpm --filter @dropletsjs/tests-examples e2e --project vue   # one example, built already
```

## Details

### What it needs

- Every package built (`pnpm build`, or `pnpm build:dist`), then every
  example built: `pnpm test:e2e` runs `pnpm build:examples` first; the
  folder's own `e2e` script does not.
- Chromium for Playwright, once:
  `pnpm --filter @dropletsjs/tests-examples exec playwright install chromium`.
- Ports 8100 (the host page) and 8400 to 8407 (one droplets server per
  example) free on `localhost`.

### Servers

| Server | Port | Started as |
|---|---|---|
| each example's droplets server | 8400 + its index in `EXAMPLES` | `node dist/server.js` in `examples/frameworks/<example>` |
| the host page | 8100 | `node e2e/host.mjs` |

Each droplets server gets `PUBLIC_BANNER`, `API_TOKEN` (the secret that must
never reach the browser) and `DROPLETS_TRUSTED_ORIGINS` set to the host
page. Playwright waits for `/health` on each.

### Host page routes (`e2e/host.mjs`)

| Route | Page |
|---|---|
| `/<example>/` | the three droplets (`client`, `ssr-hydrate`, `ssr-nohydrate`), fragments fetched on the server |
| `/<example>/written` | an element the host wrote itself, no fragment: it mounts in the browser |
| `/<example>/inserted` | a fragment fetched in the browser and inserted with `innerHTML` |
| `/<example>/one/<id>?props` | one droplet; `hydrate=` becomes the element's `data-hydrate` |
| `/<example>/mfe/*` | a proxy to the example's server under a path prefix, on the host's origin |
| `/<example>/prefixed` | the three droplets through that proxy |
| `/svelte/script` | the Svelte example's script droplet `page-views`, twice |

### What it checks

One Playwright project per example, the same checks for each
(`e2e/examples.spec.ts`): the three modes rendered, each kind of variable
where it belongs and the secret nowhere, hydration and no `client.js` for
`ssr-nohydrate`, the shared counter through `/api`, the props schema before
every load, the error page and `error()`, an `/api` route with a param and
its hook, the droplet's own files from the droplets server (or behind the
prefix), and a droplet the host writes itself. Handlebars has no client
behaviour, so its interactive checks are skipped. The Svelte project also
checks its script droplet.

The `lit` project also runs `e2e/lit.spec.ts`: declarative shadow roots in
the server markup, hydration that keeps every node, a fragment inserted
with `innerHTML`, the guestbook's form action from inside a shadow root,
the error page in its shadow root, and a click replayed after
`hydrate="interactive"`.

## Facts

- Examples covered: svelte, vue, react, solid, hono-jsx, handlebars, preact, lit. `e2e/examples.ts:2`
- Host page port is 8100. `e2e/examples.ts:7`
- Droplets server port is 8400 plus the example's index in `EXAMPLES`. `e2e/examples.ts:10`
- Playwright project per example, `baseURL` `http://localhost:8100/<example>/`. `playwright.config.ts:19`
- `e2e/lit.spec.ts` runs only in the `lit` project. `playwright.config.ts:23`
- Tests run one at a time within a project (`fullyParallel: false`). `playwright.config.ts:16`
- Reporter is `github` under `CI`, `list` otherwise. `playwright.config.ts:17`
- Browser is Playwright's `Desktop Chrome` device. `playwright.config.ts:18`
- Droplets server command is `node dist/server.js` in `../../examples/frameworks/<example>`, ready on `/health`. `playwright.config.ts:27`
- Droplets server env: `PUBLIC_BANNER=from the e2e run`, `API_TOKEN=e2e-secret-value`, `DROPLETS_TRUSTED_ORIGINS` the host page. `playwright.config.ts:30`
- Host page server is `node e2e/host.mjs`, ready on `/health`. `playwright.config.ts:38`
- Host page port can be set with `HOST_PORT`, default 8100. `e2e/host.mjs:15`
- Host page modes embedded: `client`, `ssr-hydrate`, `ssr-nohydrate`. `e2e/host.mjs:16`
- Host page fetches fragments with `x-droplet-location` set to the droplets server, or to the prefix through the proxy. `e2e/host.mjs:22`, `e2e/host.mjs:52`
- Host page embeds a 500 with HTML as the droplet's error page; other failures become `<p class="error">`. `e2e/host.mjs:23`
- Proxy `/<example>/mfe/*` forwards to the droplets server with `x-droplet-location` set to the prefix. `e2e/host.mjs:48`
- Proxy passes back `content-type`, `cache-control`, `etag`, `location`, `vary`, `link`, `set-cookie`. `e2e/host.mjs:45`
- `/<example>/written` writes `<djs-<example> data-droplet="ssr-hydrate" data-params='{"who":"Writer"}'>`. `e2e/host.mjs:100`
- `/<example>/inserted` fetches `ssr-hydrate` in the browser and sets it with `innerHTML`. `e2e/host.mjs:110`
- `/<example>/one/<id>` turns `hydrate=<word>` into `data-hydrate` on the element. `e2e/host.mjs:120`
- `/svelte/script` embeds `page-views?page=pricing` twice. `e2e/host.mjs:95`
- Handlebars is not interactive: no button, nothing hydrates. `e2e/examples.spec.ts:11`
- Secret `e2e-secret-value` never appears in any script, JSON or HTML response the browser got, nor in the page. `e2e/examples.spec.ts:55`
- `ssr-nohydrate` loads no `client.js`. `e2e/examples.spec.ts:77`
- API calls go to the droplets server, never the host page's origin. `e2e/examples.spec.ts:81`
- Shared counter: `POST /api/counter` from a click returns a higher count. `e2e/examples.spec.ts:86`
- Props schema trims `who` and defaults it to `world`; `{ props: { who: 42 } }` answers 400. `e2e/examples.spec.ts:119`
- Error page: `?who=crash` answers 500 with the error page, never the thrown message. `e2e/examples.spec.ts:135`
- `error(404)` in a load answers a plain 404 with its message. `e2e/examples.spec.ts:144`
- `/api/greet/:name` answers JSON with `requestId` equal to the `x-request-id` header set by `hooks.server.ts`. `e2e/examples.spec.ts:149`
- Script droplet tests run only for the Svelte example. `e2e/examples.spec.ts:159`
- Script droplet fragment holds only the `data-droplet-context` and `data-droplet-data` payload scripts. `e2e/examples.spec.ts:167`
- Script droplet `page-views` with `page=../etc` answers 400. `e2e/examples.spec.ts:174`
- `/api/page-views` refuses arrays, `__proto__`, path-like and too-long names, non-JSON and a number. `e2e/examples.spec.ts:199`
- `/api/page-views` with `text/plain` answers 403 or 415. `e2e/examples.spec.ts:214`
- Imported image `src` is `<droplets server or prefix>/assets/droplet-<hash>.png` and loads. `e2e/examples.spec.ts:228`
- Behind the prefix, every asset, droplet, API and `/index.js` request keeps the prefix. `e2e/examples.spec.ts:249`
- `POST /api/counter` refuses `null`, an array, a string, non-JSON and a `by` that is not an integer within ±100 (400) and a body over 64 bytes (413); `__proto__` is an own field like any other. `e2e/examples.spec.ts:274`
- The greeting a card shows is the universal load's output, on the server (`?who=Ana`) and in the browser (a host-written element). `e2e/examples.spec.ts:122`, `e2e/examples.spec.ts:268`
- Lit: server markup carries a declarative shadow root, hydration deferred. `e2e/lit.spec.ts:41`
- Lit: hydration keeps the nodes the server rendered. `e2e/lit.spec.ts:54`
- Lit: a fragment inserted with `innerHTML` gets its shadow root attached, then hydrates. `e2e/lit.spec.ts:108`
- Lit: the guestbook form in the shadow root runs its action, enhanced and as a plain post. `e2e/lit.spec.ts:143`
- Lit: the error page renders in its own shadow root and hydrates. `e2e/lit.spec.ts:173`
- Lit: with `hydrate=interactive` the first click wakes the droplet and is replayed. `e2e/lit.spec.ts:188`
- Script `e2e` is `playwright test`. `package.json:9`
- Root `test:e2e` runs `build:examples`, then this suite's `e2e`. `../../package.json:20`
