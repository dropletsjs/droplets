# runtime

The code that runs when a droplets server answers and when a droplet comes
alive in the browser. `createDropletsApp()` (`app.ts`) is the Hono app every
adapter serves. `entry-client.ts` is `/index.js`: it defines the custom element
that mounts or hydrates each droplet. Everything here uses web APIs only, so the
same files run on Node, Bun, Deno and Workers.

The app is internal: `../server/app.ts` (production) and `../vite/dev.ts`,
`../vite/prerender.ts` build it from the resolved config and the SSR bundle,
and the adapters serve its `fetch`.

```ts
// ../server/app.ts
const app = createDropletsApp({
  element: config.element,
  health: config.health,
  renderDroplet,
  loadClientModule: (name) => assets.loadClientModule(name),
  loadEntryClient: () => assets.loadEntryClient(),
  buildHash: assets.buildHash,
  origin: config.origin,
  trustedOrigins: config.trustedOrigins,
  // …
});
```

Public pieces: `$droplets/server` (`./server`, `server.ts`) and `./enhance`
(`enhance.ts`).

```html
<!-- what a host page does -->
<script type="module" src="https://droplets.example.com/index.js"></script>
<djs-droplet data-droplet="counter" data-params='{"start":3}'></djs-droplet>
```

## Details

### Files

| File | What it is |
|---|---|
| `app.ts` | `createDropletsApp`: the middleware chain and every route. |
| `host.ts`, `web-url.ts` | The droplet location from request headers, `event.host`, the prerender host tokens. |
| `security.ts` | The origin (CSRF) check, the body size limits, `DROPLETS_ORIGIN` and `DROPLETS_TRUSTED_ORIGINS`. |
| `dev-log.ts` | The runtime's warnings, for `vite dev` and the build's prerender; a production server has none. |
| `cookies.ts` | `event.cookies`: parse, serialize, defaults, read-only and prerender jars. |
| `form.ts`, `form-token.server.ts`, `enhance.ts` | Form actions: action URLs, reserved query keys, the signed no-JavaScript result, `enhanceDropletForm`. |
| `element.ts` | The fragment markup the server writes. |
| `entry-server.ts`, `load.ts`, `props.ts`, `load-headers.ts` | The server bundle's registry, `load`, props validation, `setHeaders`. |
| `server.ts` | `$droplets/server`: `error`, `redirect`, `fail`, `json`, `text`, `sequence`, the event types. |
| `server-records.ts` | Per element and build: where `/index.js` was served from, the public env. |
| `entry-client.ts`, `client-init.ts` | `/index.js`: the custom element and `hooks.client` `init()`. |
| `request-store.ts`, `env-store.ts`, `base64.ts`, `routes.ts` | Per-request info, the runtime env, base64, `/api` route matching. |
| `dev-element.ts`, `dev-notify.ts`, `dev-tool.ts` | Dev only: HMR strategies, toasts, the dev tool hookup. |

### Routes

| Route | Answer |
|---|---|
| `GET /health` | `ok` (path from `health`, `false` turns it off). |
| `GET /` | The index page when there is one (the dev page), else 404. |
| `GET /index.js` | The element loader as `loadEntryClient` gives it (the build's `index.js`, the dev loader), `no-store`. |
| `GET /env.js` | The public runtime variables as a script, `public, max-age=600` (`DROPLETS_ENV_MAX_AGE`); 404 without any. |
| `GET /index.css` | The global styles, cached a month, immutable. |
| `GET /droplets/:id` | The fragment HTML (live, prerendered or the error page). |
| `POST /droplets/:id` | JSON body: render with those props. Form body: run the action. |
| `GET\|POST /droplets/:id/_data` | `{ data, form? }` or `{ error }` as JSON. |
| `GET /droplets/:id/style.css`, `/client.js` | The droplet's CSS and client module, cached a month, immutable. |
| `/api`, `/api/*` | The project's `+server.ts` routes. |
| import map path | Only with `importMap` set. |

### Request lifecycle

Every request: location → CORS → health → request info → origin check → size limits → finalizer.
Then, except for `/index.js`, `/env.js` and `/assets/*`: body, `event.host`, cookies, `event`, `handle`.
Then the route.

## Facts

### Location and headers

- The droplet location is resolved once per request in `resolveLocation` and stored on the context before any route runs. `app.ts:916`
- The location header order is `x-droplet-location`, then `Forwarded`, then `X-Forwarded-Host` with `X-Forwarded-Proto`/`X-Forwarded-Port`. `host.ts:81`
- `x-droplet-location` with a comma in it is ignored. `host.ts:84`
- `X-Forwarded-Prefix` supplies the prefix for `Forwarded` and `X-Forwarded-Host` (its first value only). `host.ts:88`
- `X-Forwarded-Port` is used only when it is 1-65535 and `X-Forwarded-Host` has no port. `host.ts:99`
- `Forwarded` is read from its first element only, with quotes stripped. `host.ts:150`
- A location prefix is accepted only if it starts with `/`, is at most 256 characters and has no `//`, `\`, `..`, `?`, `#` or control characters. `web-url.ts:46`
- `webUrl` accepts only `http:`/`https:` URLs and strips credentials and the hash. `web-url.ts:10`
- A header location is trusted only when its origin is the request's own, an `origin` entry or a `trustedOrigins` entry; `"*"` in either trusts any. `app.ts:470`
- An untrusted location header is ignored; under `vite dev` it warns once per source, the value cut to 200 characters. `app.ts:477`, `dev-log.ts:42`
- Without a trusted header the location is the single `origin` entry, else the request's own origin. `app.ts:479`
- `DROPLETS_ORIGIN` overrides `origin`, and `DROPLETS_TRUSTED_ORIGINS` overrides `trustedOrigins`, read per request. `app.ts:831`
- `"*"` in `origin`, `trustedOrigins` or their env variables is never refused; under `vite dev` it warns `"*" trusts any forwarded location`. `app.ts:839`, `security.ts:73`, `dev-log.ts:49`
- A malformed `DROPLETS_ORIGIN`/`DROPLETS_TRUSTED_ORIGINS` entry is skipped; under `vite dev` it warns once per raw value. `security.ts:70`, `security.ts:101`, `dev-log.ts:52`
- `Vary` on fragments and `_data` lists `x-droplet-location`, `forwarded`, `x-forwarded-host`, `x-forwarded-proto`, `x-forwarded-port`, `x-forwarded-prefix` and `origin`. `app.ts:420`
- CORS exposes `Link` and `x-droplets-build`. `app.ts:278`
- `x-droplets-build` carries the build hash on `_data` answers. `app.ts:1271`
- `x-droplets-prerender-error: host` or `cookies` marks a 500 when a prerendered droplet reads the host, props, URL or cookies. `app.ts:675`
- `event.url` is the request path on the location's origin. `app.ts:657`
- `event.host` is the `Origin` header (skipping `null`), else the location's origin. `host.ts:181`

### Middleware and `handle`

- `handle`, the body read, `event.host`, cookies and `event` are skipped for `/index.js`, `/env.js` and `/assets/*`. `app.ts:348`, `app.ts:974`
- The health route answers `ok` before `handle` runs; its path defaults to `/health`. `app.ts:926`
- The request body is read only for a droplet that exists. `app.ts:979`
- A `handle` that throws answers through `handleError`, as text. `app.ts:1037`
- A `handle` that returns something other than a `Response` answers `handle must return a Response`. `app.ts:1040`
- A failing `hooks.server` import answers through `handleError`, as text. `app.ts:1016`

### Origin check and limits

- The origin check runs unless `csrf.checkOrigin` is `false`. `app.ts:944`
- The origin check refuses a cross-site POST, PUT, PATCH or DELETE with a form-capable type with 403 `Cross-site <METHOD> form submissions are forbidden`. `security.ts:159`
- The origin check lets an untyped request without `Origin` through. `security.ts:157`
- The origin check lets every request through when `trustedOrigins` has `"*"`. `security.ts:155`
- The origin check guards `/api`, `/api/`, `/droplets/` and the import map paths. `security.ts:116`
- Body limits default to 1 MB JSON, 1 MB form, 10 MB multipart and 8 KB `x-droplet-props`. `../core/config.ts:197`
- A body over its type's limit answers 413 `Payload Too Large`. `security.ts:180`
- An `x-droplet-props` header over its limit answers 431 `x-droplet-props is too large; send the props in a POST body`. `security.ts:186`
- A limit of `Infinity` turns that check off. `security.ts:189`
- `limitFor` maps `application/json` and `+json` to the JSON limit, form-urlencoded and `text/plain` to the form limit, anything else to multipart. `security.ts:166`

### Props

- Fragment props come from the query minus the reserved keys, else from the base64 `x-droplet-props` header. `app.ts:378`
- A malformed `x-droplet-props` is ignored; under `vite dev` it warns `ignoring malformed x-droplet-props header`. `app.ts:392`, `dev-log.ts:73`
- POST props for a render come from the JSON body (`props`, `context`); an action POST takes them from the query. `app.ts:790`
- The JSON body is read only for POST with a content type containing `application/json`; malformed JSON gives no props. `app.ts:317`
- Reserved query keys are `__cb`, `c`, `t`, `noSSR`, `clientOnly`, `__droplet_return`, every key starting with `/` and every key starting with `__droplet_form_`. `form.ts:26`
- `clientOnly` and `noSSR` in the query count by presence. `app.ts:779`
- Props validation errors (`PropsError`) answer 400 with `Invalid props: …`. `entry-server.ts:143`
- `propsKey` sorts keys, so props differing only in key order share a prerender entry. `props.ts:90`

### Fragments: `GET|POST /droplets/:id`

- An unknown droplet answers 404 `Not Found`, as text. `app.ts:777`
- A droplet name in the URL is decoded; a malformed escape names no droplet. `app.ts:758`
- The droplet registry is a `Map`, so `__proto__` names no droplet. `entry-server.ts:57`
- A POST with a form body runs an action, `text/plain` answers 415, and a `?/name` key with a non-form body answers 400. `app.ts:1657`
- A prerendered fragment is looked up by host key, then by props key. `app.ts:1217`
- A prerendered lookup for a droplet with `ssr = false` and no entry for these props answers 404. `app.ts:1220`
- The fragment's context script is written only when SSR ran (`!noSSR && ssr`). `app.ts:1453`
- `data-droplet-data` is written only when the droplet hydrates and the request is not `clientOnly`. `app.ts:1475`
- `data-render-id` is written only when there is server HTML. `app.ts:1474`
- A failed render answers 500 with the error component, else the action's status, else 200. `app.ts:1483`
- A response carrying a form result gets `cache-control: private, no-store`. `app.ts:1466`
- `fragmentCacheControl` defaults to `private, no-store` and is set only when the response has none. `../core/config.ts:198`
- The `Link` header preloads `style.css` (only with styles), each CSS file and the entry, and modulepreloads `client.js` only when `hydrate === true`. `app.ts:1310`
- `linkHeader: false` drops the `Link` header. `app.ts:1315`
- `client.js` and `style.css` URLs in a fragment carry `?c=<build>`. `app.ts:1298`
- The origin check counts a POST, PUT, PATCH or DELETE as form-capable when it is form-urlencoded, multipart or `text/plain`. `security.ts:33`
- Every URL a fragment emits for its own files is built on the droplet location. `app.ts:1311`

### `_data`

- `_data` answers `{ data }`, plus `form` when a result is carried. `app.ts:1284`
- `_data` answers a failed load with 500 `{ error }`. `app.ts:1282`
- `_data` answers PUT, PATCH and DELETE with 405 and `allow: GET, POST`. `app.ts:1265`
- `_data` carrying a form result gets `cache-control: private, no-store`. `app.ts:1286`

### Static routes

- `/index.js` answers 404 without `loadEntryClient` or code, and is `no-store`. `app.ts:1101`, `app.ts:1106`
- `/index.js` answers what `loadEntryClient` returns, with nothing added. `app.ts:1107`
- `/env.js` answers 404 without `publicEnv` or when it has no names (no `public: true` variable without `static`). `app.ts:1116`, `app.ts:1119`
- `/env.js` is `publicEnvScript` of `publicEnv()` under `<element>:<build>`, read through `readRuntimeEnv`, nothing taken from the request. `app.ts:1122`, `entry-server.ts:385`
- `/env.js` cache-control is `public, max-age=600`; `DROPLETS_ENV_MAX_AGE` sets the seconds, `0` gives `no-store`. `app.ts:352`, `app.ts:370`, `app.ts:1121`
- `DROPLETS_ENV_MAX_AGE` is parsed once per raw value (a `Map`); anything but a non-negative integer of seconds keeps 600, with a warning once per value under `vite dev` only. `app.ts:355`, `app.ts:369`, `dev-log.ts:78`
- `/index.css` answers 404 when there is no global CSS or it is empty. `app.ts:1132`
- `style.css` answers 404 when the droplet has no stylesheets, or no `dropletStyles` loader is set; with stylesheets it answers `text/css`, cached a month. `app.ts:1144`, `app.ts:1148`
- `styleImports` is `style.css`: one `@import url("../../<file>")` per stylesheet, relative to `/droplets/<id>/style.css`; `vite build` writes the same as a file. `app.ts:297`, `../vite/build.ts:327`
- A fragment links and preloads `style.css` only when the droplet has stylesheets. `app.ts:1314`
- `client.js` answers 404 for an unknown droplet, `hydrate === false` or no loader. `app.ts:1160`
- Cached files get `public, max-age=2592000, immutable`. `app.ts:910`
- The import map answers 404 when none is configured, is `no-store`, and escapes `<`. `app.ts:1079`
- `/` answers `loadIndex()`'s HTML, else 404. `app.ts:1093`

### Form actions

- A request names one action at most; two `?/name` keys answer 400 `One action per request: ?/name once`. `app.ts:1528`
- A droplet without `actions` answers 405 with `allow: GET`. `app.ts:1555`
- An unknown action answers 404 `No action named "<name>"`, the name cut to 100 characters. `app.ts:1538`
- Action names match `^[A-Za-z_][\w-]*$`. `form.ts:141`
- An action is found only through `ACTION_NAME`, a deny list (`__proto__`, `constructor`, `prototype`) and `Object.hasOwn`. `entry-server.ts:316`
- An action answers JSON when `accept` contains `application/json`. `app.ts:1542`
- A JSON action answer is the outcome with the failure's status, else 200. `app.ts:1607`
- An action redirect, native or JSON, goes only to this server or a trusted origin (`redirectTarget`, the same check in both modes), else 400 `Bad Request: the action redirects off this site` (as `{ message }` in JSON) and a `console.error`. `app.ts:1593`, `app.ts:1599`
- A JSON action redirect answers 200 `{ type: "redirect", status, location }` with the checked absolute URL. `app.ts:1602`
- A native action redirect answers 303. `app.ts:1603`
- Action data that is not plain JSON (depth over 64, non-finite numbers, non-plain prototypes) answers 500. `app.ts:503`
- With `DROPLETS_SECRET` set, a form posted without JavaScript needs `__droplet_return` or a `Referer` on this server or a trusted origin, else 400. `app.ts:1549`
- With `DROPLETS_SECRET`, a native post answers 303 back to its page with `__droplet_form_<droplet>_<build>` holding the signed result. `app.ts:1626`
- Without `DROPLETS_SECRET`, a native post answers the fragment with the form result inline. `app.ts:1611`
- A form result over 2 KB is sent without its data; under `vite dev` with a warning. `app.ts:1624`, `dev-log.ts:76`
- The back page refuses `<location>/droplets…` URLs. `app.ts:610`
- `__droplet_return` is at most 2048 characters. `app.ts:628`
- A carried form result is used only when its action still exists. `app.ts:887`

### Form tokens (`form-token.server.ts`)

- The form token is verified with HMAC-SHA-256 before its payload is parsed. `form-token.server.ts:199`
- A form token is at most 2048 characters. `form-token.server.ts:26`
- A form token lives 5 minutes, with 60 seconds of clock skew. `form-token.server.ts:22`
- `DROPLETS_SECRET` should be at least 32 bytes; a missing or shorter one is ignored, with a warning once under `vite dev`. `form-token.server.ts:28`, `form-token.server.ts:80`, `dev-log.ts:57`
- The token's MAC covers the version `droplets-form-v2`, the droplet, the build and the page. `form-token.server.ts:111`
- A form token's status must be 200 or 400-599. `form-token.server.ts:222`
- A form token's data is copied into null-prototype objects. `form-token.server.ts:154`

### Cookies

- Cookies default to `httpOnly`, `sameSite: "lax"` and `secure`, except over plain HTTP to a loopback host. `cookies.ts:117`
- Setting, deleting or serializing a cookie needs an absolute `path`. `cookies.ts:82`
- `sameSite: "none"` needs `secure: true`. `cookies.ts:71`
- Cookie parsing keeps the first value of a name. `cookies.ts:26`
- Cookies are read-only in `load`; `set`, `delete` and `serialize` throw. `cookies.ts:175`
- `setHeaders` refuses `set-cookie`. `load-headers.ts:35`

### `$droplets/server` (`server.ts`)

- `error(status)` takes 400-599. `server.ts:354`
- `redirect(status, location)` takes 300-308 and an http(s) or on-site target. `server.ts:365`
- `fail(status)` takes 400-599. `server.ts:416`
- `json()` sets `content-type: application/json`. `server.ts:503`
- `text()` sets `text/plain; charset=utf-8`. `server.ts:508`
- A thrown `HttpError` answers its status and message; a thrown `Redirect` answers its location as written. `app.ts:719`
- Any other thrown error is logged and answers 500 with `handleError`'s message, never a stack. `app.ts:719`
- Without `handleError`, production renders answer `Internal Error`. `load.ts:40`

### `/api`

- `/api` without a matching route answers 404 `{ "message": "Not Found" }`. `app.ts:1667`
- `/api` accepts GET, POST, PUT, PATCH, DELETE, OPTIONS and HEAD. `routes.ts:6`
- `/api` HEAD falls back to GET with a null body. `app.ts:1673`
- `/api` picks the method handler through `Object.hasOwn`, else `fallback`. `app.ts:1675`
- `/api` answers an unhandled method with 405 and `allow`. `app.ts:1679`
- `/api` answers a handler that returns no `Response` with 500 JSON. `app.ts:1686`
- `allowedMethods` adds HEAD when GET is there. `routes.ts:93`

### Prerender host tokens

- Prerender host tokens are `__$DROPLET_HOST<nonce>$__`, `__$DROPLET_PATH<nonce>$__` and `http://droplets.invalid/__$DROPLET_LOCATION<nonce>$__`. `host.ts:126`
- `tokenNonce` is 16 random hex characters. `host.ts:140`
- Host tokens are replaced HTML-escaped in markup and JSON-escaped in data. `host.ts:279`
- `tokenNonce` also replaces tokens in live renders. `app.ts:1263`

### Fragment markup (`element.ts`)

- The fragment element is `<djs-droplet>` unless `element` says otherwise. `app.ts:116`
- The fragment element carries `data-droplet`, and optionally `data-build`, `data-render-id`, `data-context` and `data-droplet-error`. `element.ts:59`
- Inline payloads are `<script type="application/text">` with `data-droplet-context` or `data-droplet-data`. `element.ts:44`
- The droplet's stylesheet link carries `data-droplet-style`. `element.ts:65`
- Server HTML sits in `<div style="display: contents" data-droplet-entry>`. `element.ts:66`
- Inline JSON escapes `<` as `<`. `app.ts:401`

### Server records and env

- `serverKey` is `<element>:<build>`, shared by `/index.js`, `$droplets/drop` and `$droplets/form`. `server-records.ts:27`
- `serverLocation` is the record's origin, else the build root `__DROPLETS_BUILD_ROOT__` from `import.meta.url`. `server-records.ts:48`
- The runtime env falls back to `process.env` where `process` exists. `env-store.ts:26`
- Request info uses `AsyncLocalStorage` through `process.getBuiltinModule`, never a Node import. `request-store.ts:39`
- A production server logs errors only, with `console.error`: a plain message, then the error as it is. `app.ts:699`, `app.ts:707`, `app.ts:730`, `app.ts:1583`, `app.ts:1595`, `entry-server.ts:227`
- Runtime warnings reach the logger only through `devLog` (`vite dev`, the build's prerender) or behind `import.meta.env.DEV` (`entry-server.ts`), so a production bundle holds neither. `app.ts:184`, `entry-server.ts:123`, `entry-server.ts:348`
- `DEV_DROPLETS_LOG` sets the level of the dev and build log; a production server ignores it. `../core/logger.ts:41`

### The element (`entry-client.ts`)

- The element reads props from the inline context script, then `data-context`, then `data-params` (plain JSON). `entry-client.ts:442`
- The element's server location is `serverLocation` for its element and build. `entry-client.ts:368`
- `_data` is fetched with POST to `<location>/droplets/<id>/_data?__cb=<now>`, a JSON body and `redirect: "manual"`. `entry-client.ts:721`
- `data-hydrate` takes `""`, `true`, `false`, `visible` and `interactive`, case-sensitive. `entry-client.ts:1097`
- `data-hydrate="false"` never stops a script droplet. `entry-client.ts:1106`
- `interactive` without server markup hydrates at once. `entry-client.ts:1114`
- `visible` uses a 200px root margin, 1000px without markup. `entry-client.ts:189`
- `interactive` waits for `pointerdown`, `focusin`, `keydown` or `click`. `entry-client.ts:192`
- Clicks before hydrate are captured, and dropped instead of replayed after 1500 ms of waiting or once 10 s old. `entry-client.ts:680`
- A second click within 400 ms of the first counts as a retry, not a new click. `entry-client.ts:626`
- A build mismatch keeps the server HTML and dispatches `droplets:stale` (bubbles, composed). `entry-client.ts:1177`
- An unknown droplet keeps its markup and does nothing. `entry-client.ts:1165`
- Host children go into `[data-droplet-slot]` or replace `[data-droplet-children]`, moved with `moveBefore` when available. `entry-client.ts:180`
- `data-droplets-enhance` on a form opts it into `enhanceDropletForm`. `entry-client.ts:1266`
- Re-rendering a fragment needs a `text/html` answer. `entry-client.ts:1315`
- `connectedMoveCallback` keeps the instance when the element is moved. `entry-client.ts:708`
- `disconnectedCallback` tears down in a microtask, so a re-insert keeps the instance. `entry-client.ts:1355`
- Dev code reaches the element only through `if (import.meta.env.DEV) installDevElement(...)`. `entry-client.ts:1374`

### `enhanceDropletForm` (`enhance.ts`)

- `enhanceDropletForm` intercepts only POST forms, form-urlencoded or multipart, with target `""` or `_self`. `enhance.ts:155`
- `enhanceDropletForm` intercepts only forms posting to exactly `<location>/droplets/<id>`. `enhance.ts:167`
- `enhanceDropletForm` posts with `accept: application/json` and `redirect: "manual"`. `enhance.ts:340`
- `enhanceDropletForm` dispatches `droplets:action` on `globalThis`. `enhance.ts:361`
- `enhanceDropletForm` reads the answer through `Object.hasOwn`. `enhance.ts:213`
- `enhanceDropletForm` follows only an absolute http(s) redirect location without credentials, as the server answers one; a relative, protocol-relative (`//…`, `/\…`) or `javascript:` one is logged and not followed. `enhance.ts:240`, `enhance.ts:365`

### `hooks.client`

- `init()` that is not a function logs an error; a rejection or throw is logged, never awaited. `client-init.ts:44`

### Dev

- Dev strategies come from `?strategy=`, then `sessionStorage` `droplets:strategy:<origin>`, then the config. `dev-element.ts:222`
- Dev follows `droplets:update`, `vite:beforeUpdate`, `droplets:hooks-client` and `droplets:hot-fallback`. `dev-element.ts:659`
- Dev toasts show at most 3, and a toast without a reload button closes after 10 s. `dev-notify.ts:94`
- The dev tool is injected per `?injectTool=` (anything but `false` injects), else per the config. `dev-element.ts:738`
