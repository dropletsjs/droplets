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
| `host.ts`, `web-url.ts` | The droplet location from request headers, `event.host`, a fixed `host`. |
| `host-tokens.ts` | The host and location tokens of a build and their replacement per request; only a build that computes either per request bundles it. |
| `security.ts` | The origin (CSRF) check, the body size limits, `DROPLETS_TRUSTED_ORIGINS`. |
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
| `GET /index.css` | An `@import` of the shared stylesheet, `no-store`; `404` without one. |
| `GET /droplets/:id` | The fragment HTML (live, prerendered or the error page). |
| `POST /droplets/:id` | JSON body: render with those props. Form body: run the action. |
| `GET\|POST /droplets/:id/_data` | `{ data, form? }` or `{ error }` as JSON. |
| `GET /droplets/:id/style.css`, `/client.js` | The droplet's CSS and client module, cached a month, immutable. |
| `/api`, `/api/*` | The project's `+server.ts` routes. |
| import map path | Only with `importMap` set. |

### Request lifecycle

Every request: location → CORS → health → request info → origin check → size limits → finalizer.
Then, except for `/index.js`, `/index.css`, `/env.js` and `/assets/*`: body, `event.host`, cookies, `event`, `handle`.
Then the route.

## Facts

### Location and headers

- The droplet location is resolved once per request in `resolveLocation` and stored on the context before any route runs. `app.ts:924`
- The location header order is `x-droplet-location`, then `Forwarded`, then `X-Forwarded-Host` with `X-Forwarded-Proto`/`X-Forwarded-Port`. `host.ts:80`
- `x-droplet-location` with a comma in it is ignored. `host.ts:83`
- `X-Forwarded-Prefix` supplies the prefix for `Forwarded` and `X-Forwarded-Host` (its first value only). `host.ts:87`
- `X-Forwarded-Port` is used only when it is 1-65535 and `X-Forwarded-Host` has no port. `host.ts:98`
- `Forwarded` is read from its first element only, with quotes stripped. `host.ts:111`
- A location prefix is accepted only if it starts with `/`, is at most 256 characters and has no `//`, `\`, `..`, `?`, `#` or control characters. `web-url.ts:46`
- `webUrl` accepts only `http:`/`https:` URLs and strips credentials and the hash. `web-url.ts:10`
- A header location is trusted only when its origin is the request's own or a `trustedOrigins` entry; `"*"` in `trustedOrigins` trusts any. `app.ts:482`, `app.ts:485`
- An untrusted location header is ignored; under `vite dev` it warns once per source, the value cut to 200 characters. `app.ts:486`, `dev-log.ts:42`
- Without a trusted header the location is the request's own origin. `app.ts:488`
- With `location`, every request's location is it and no location header is read. `app.ts:925`
- With `location`, the request info's origin is `location` at build too. `app.ts:942`
- `DROPLETS_TRUSTED_ORIGINS` adds to `trustedOrigins`, read per request. `app.ts:840`
- `"*"` in `trustedOrigins` or `DROPLETS_TRUSTED_ORIGINS` is never refused; under `vite dev` it warns `"*" trusts any forwarded location`. `app.ts:846`, `security.ts:73`, `dev-log.ts:49`
- A malformed `DROPLETS_TRUSTED_ORIGINS` entry is skipped; under `vite dev` it warns once per raw value. `security.ts:70`, `dev-log.ts:52`
- `Vary` on fragments and `_data` lists `x-droplet-location`, `forwarded`, `x-forwarded-host`, `x-forwarded-proto`, `x-forwarded-port`, `x-forwarded-prefix` and `origin`; with `location`, `origin` alone. `app.ts:428`, `app.ts:439`, `app.ts:1199`
- CORS exposes `Link` and `x-droplets-build`. `app.ts:286`
- `x-droplets-build` carries the build hash on `_data` answers. `app.ts:1290`
- `x-droplets-prerender-error: host` or `cookies` marks a 500 when a prerendered droplet reads the host, props, URL or cookies. `app.ts:683`
- `event.url` is the request path on the location's origin. `app.ts:665`
- `event.host` is the `Origin` header (skipping `null`), else the location's origin. `host.ts:142`
- With `host`, `event.host` is its origin plus the reported page's path and query when that page is on it, else the origin alone; `Origin` is not read. `app.ts:1016`, `host.ts:158`
- A reported path is set on the fixed host's URL, never joined, so `//evil.example` stays a path. `host.ts:162`
- `host` joins `trustedOrigins` for the origin check and the action redirect allow-list, not for location trust. `app.ts:843`

### Middleware and `handle`

- `handle`, the body read, `event.host`, cookies and `event` are skipped for `/index.js`, `/index.css`, `/env.js` and `/assets/*`. `app.ts:356`, `app.ts:982`
- The health route answers `ok` before `handle` runs; its path defaults to `/health`. `app.ts:934`
- The request body is read only for a droplet that exists. `app.ts:987`
- A `handle` that throws answers through `handleError`, as text. `app.ts:1051`
- A `handle` that returns something other than a `Response` answers `handle must return a Response`. `app.ts:1054`
- A failing `hooks.server` import answers through `handleError`, as text. `app.ts:1030`

### Origin check and limits

- The origin check runs unless `csrf.checkOrigin` is `false`. `app.ts:952`
- The origin check refuses a cross-site POST, PUT, PATCH or DELETE with a form-capable type with 403 `Cross-site <METHOD> form submissions are forbidden`. `security.ts:128`
- The origin check lets an untyped request without `Origin` through. `security.ts:126`
- The origin check lets every request through when `trustedOrigins` has `"*"`. `security.ts:124`
- The origin check guards `/api`, `/api/`, `/droplets/` and the import map paths. `security.ts:85`
- Body limits default to 1 MB JSON, 1 MB form, 10 MB multipart and 8 KB `x-droplet-props`. `../core/config.ts:207`
- A body over its type's limit answers 413 `Payload Too Large`. `security.ts:149`
- An `x-droplet-props` header over its limit answers 431 `x-droplet-props is too large; send the props in a POST body`. `security.ts:155`
- A limit of `Infinity` turns that check off. `security.ts:158`
- `limitFor` maps `application/json` and `+json` to the JSON limit, form-urlencoded and `text/plain` to the form limit, anything else to multipart. `security.ts:135`

### Props

- Fragment props come from the query minus the reserved keys, else from the base64 `x-droplet-props` header. `app.ts:386`
- A malformed `x-droplet-props` is ignored; under `vite dev` it warns `ignoring malformed x-droplet-props header`. `app.ts:400`, `dev-log.ts:69`
- POST props for a render come from the JSON body (`props`, `context`); an action POST takes them from the query. `app.ts:798`
- The JSON body is read only for POST with a content type containing `application/json`; malformed JSON gives no props. `app.ts:325`
- Reserved query keys are `__cb`, `c`, `t`, `noSSR`, `clientOnly`, `__droplet_return`, every key starting with `/` and every key starting with `__droplet_form_`. `form.ts:26`
- `clientOnly` and `noSSR` in the query count by presence. `app.ts:787`
- Props validation errors (`PropsError`) answer 400 with `Invalid props: …`. `entry-server.ts:143`
- `propsKey` sorts keys, so props differing only in key order share a prerender entry. `props.ts:90`

### Fragments: `GET|POST /droplets/:id`

- An unknown droplet answers 404 `Not Found`, as text. `app.ts:785`
- A droplet name in the URL is decoded; a malformed escape names no droplet. `app.ts:766`
- The droplet registry is a `Map`, so `__proto__` names no droplet. `entry-server.ts:57`
- A POST with a form body runs an action, `text/plain` answers 415, and a `?/name` key with a non-form body answers 400. `app.ts:1680`
- A prerendered fragment is looked up by host key (origin and path), then, with `host`, by the origin-only key, then by props key. `app.ts:1234`, `app.ts:1237`, `app.ts:1238`
- `prerenderKey` is `<propsKey> <origin><path>`, `<propsKey> <origin>` for a render for `host` of the config, or `<propsKey>` for a host-agnostic one. `props.ts:103`
- A prerendered lookup for a droplet with `ssr = false` and no entry for these props answers 404. `app.ts:1239`
- The fragment's context script is written only when SSR ran (`!noSSR && ssr`). `app.ts:1476`
- `data-droplet-data` is written only when the droplet hydrates and the request is not `clientOnly`. `app.ts:1498`
- `data-render-id` is written only when there is server HTML. `app.ts:1497`
- A failed render answers 500 with the error component, else the action's status, else 200. `app.ts:1506`
- A response carrying a form result gets `cache-control: private, no-store`. `app.ts:1489`
- `fragmentCacheControl` defaults to `private, no-store` and is set only when the response has none. `../core/config.ts:208`
- The `Link` header preloads `style.css` (only with styles), each CSS file and the entry, and modulepreloads `client.js` only when `hydrate === true`. `app.ts:1329`
- `linkHeader: false` drops the `Link` header. `app.ts:1334`
- `client.js` and `style.css` URLs in a fragment carry `?c=<build>`. `app.ts:1317`
- The origin check counts a POST, PUT, PATCH or DELETE as form-capable when it is form-urlencoded, multipart or `text/plain`. `security.ts:33`
- Every URL a fragment emits for its own files is built on the droplet location. `app.ts:1330`

### `_data`

- `_data` answers `{ data }`, plus `form` when a result is carried. `app.ts:1303`
- `_data` answers a failed load with 500 `{ error }`. `app.ts:1301`
- `_data` answers PUT, PATCH and DELETE with 405 and `allow: GET, POST`. `app.ts:1284`
- `_data` carrying a form result gets `cache-control: private, no-store`. `app.ts:1305`

### Static routes

- `/index.js` answers 404 without `loadEntryClient` or code, and is `no-store`. `app.ts:1115`, `app.ts:1120`
- `/index.js` answers what `loadEntryClient` returns, with nothing added. `app.ts:1121`
- `/env.js` answers 404 without `publicEnv` or when it has no names (no `public: true` variable without `static`). `app.ts:1130`, `app.ts:1133`
- `/env.js` is `publicEnvScript` of `publicEnv()` under `<element>:<build>`, read through `readRuntimeEnv`, nothing taken from the request. `app.ts:1136`, `entry-server.ts:386`
- `/env.js` cache-control is `public, max-age=600`; `DROPLETS_ENV_MAX_AGE` sets the seconds, `0` gives `no-store`. `app.ts:360`, `app.ts:378`, `app.ts:1135`
- `DROPLETS_ENV_MAX_AGE` is parsed once per raw value (a `Map`); anything but a non-negative integer of seconds keeps 600, with a warning once per value under `vite dev` only. `app.ts:363`, `app.ts:377`, `dev-log.ts:74`
- `/index.css` answers 404 when there is no global CSS or it is empty. `app.ts:1146`
- `style.css` answers 404 when the droplet has no stylesheets, or no `dropletStyles` loader is set; with stylesheets it answers `text/css`, cached a month. `app.ts:1158`, `app.ts:1162`
- `styleImports` is `style.css`: one `@import url("../../<file>")` per stylesheet, relative to `/droplets/<id>/style.css`; `vite build` writes the same as a file. `app.ts:305`, `../vite/build.ts:327`
- A fragment links and preloads `style.css` only when the droplet has stylesheets. `app.ts:1333`
- `client.js` answers 404 for an unknown droplet, `hydrate === false` or no loader. `app.ts:1174`
- Cached files get `public, max-age=2592000, immutable`. `app.ts:918`
- The import map answers 404 when none is configured, is `no-store`, and escapes `<`. `app.ts:1093`
- `/` answers `loadIndex()`'s HTML, else 404. `app.ts:1107`

### Form actions

- A request names one action at most; two `?/name` keys answer 400 `One action per request: ?/name once`. `app.ts:1551`
- A droplet without `actions` answers 405 with `allow: GET`. `app.ts:1578`
- An unknown action answers 404 `No action named "<name>"`, the name cut to 100 characters. `app.ts:1562`
- Action names match `^[A-Za-z_][\w-]*$`. `form.ts:141`
- An action is found only through `ACTION_NAME`, a deny list (`__proto__`, `constructor`, `prototype`) and `Object.hasOwn`. `entry-server.ts:316`
- An action answers JSON when `accept` contains `application/json`. `app.ts:1565`
- A JSON action answer is the outcome with the failure's status, else 200. `app.ts:1630`
- An action redirect, native or JSON, goes only to this server or a trusted origin (`redirectTarget`, the same check in both modes), else 400 `Bad Request: the action redirects off this site` (as `{ message }` in JSON) and a `console.error`. `app.ts:1616`, `app.ts:1622`
- A JSON action redirect answers 200 `{ type: "redirect", status, location }` with the checked absolute URL. `app.ts:1625`
- A native action redirect answers 303. `app.ts:1626`
- Action data that is not plain JSON (depth over 64, non-finite numbers, non-plain prototypes) answers 500. `app.ts:511`
- With `DROPLETS_SECRET` set, a form posted without JavaScript needs `__droplet_return` or a `Referer` on this server or a trusted origin, else 400. `app.ts:1572`
- With `DROPLETS_SECRET`, a native post answers 303 back to its page with `__droplet_form_<droplet>_<build>` holding the signed result. `app.ts:1649`
- Without `DROPLETS_SECRET`, a native post answers the fragment with the form result inline. `app.ts:1634`
- A form result over 2 KB is sent without its data; under `vite dev` with a warning. `app.ts:1647`, `dev-log.ts:72`
- The back page refuses `<location>/droplets…` URLs. `app.ts:618`
- `__droplet_return` is at most 2048 characters. `app.ts:636`
- A carried form result is used only when its action still exists. `app.ts:895`

### Form tokens (`form-token.server.ts`)

- The form token is verified with HMAC-SHA-256 before its payload is parsed. `form-token.server.ts:199`
- A form token is at most 2048 characters. `form-token.server.ts:26`
- A form token lives 5 minutes, with 60 seconds of clock skew. `form-token.server.ts:22`
- `DROPLETS_SECRET` should be at least 32 bytes; a missing or shorter one is ignored, with a warning once under `vite dev`. `form-token.server.ts:28`, `form-token.server.ts:80`, `dev-log.ts:55`
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
- A thrown `HttpError` answers its status and message; a thrown `Redirect` answers its location as written. `app.ts:727`
- Any other thrown error is logged and answers 500 with `handleError`'s message, never a stack. `app.ts:727`
- Without `handleError`, production renders answer `Internal Error`. `load.ts:40`

### `/api`

- `/api` without a matching route answers 404 `{ "message": "Not Found" }`. `app.ts:1690`
- `/api` accepts GET, POST, PUT, PATCH, DELETE, OPTIONS and HEAD. `routes.ts:6`
- `/api` HEAD falls back to GET with a null body. `app.ts:1696`
- `/api` picks the method handler through `Object.hasOwn`, else `fallback`. `app.ts:1698`
- `/api` answers an unhandled method with 405 and `allow`. `app.ts:1702`
- `/api` answers a handler that returns no `Response` with 500 JSON. `app.ts:1709`
- `allowedMethods` adds HEAD when GET is there. `routes.ts:93`

### Prerender host tokens

- Prerender host tokens are `__$DROPLET_HOST_<nonce>$__`, `__$DROPLET_PATH_<nonce>$__` and `http://droplets.invalid/__$DROPLET_LOCATION_<nonce>$__` (no `_<nonce>` without a nonce). `host-tokens.ts:26`
- `tokenNonce` is 16 random hex characters. `host-tokens.ts:43`
- At build, an entry without `host` under `host` of the config renders for a real URL of that origin, `pathname` and `href` the path token; it is stored under the origin-only key. `app.ts:991`, `host.ts:175`, `app.ts:1394`
- Host tokens are replaced HTML-escaped in markup and JSON-escaped in data. `host-tokens.ts:137`
- `tokenNonce` also replaces tokens in live renders. `app.ts:852`, `app.ts:1262`
- `app.ts` imports `host-tokens.ts` for its types only: the replacers come in as the internal `tokens` option, from the SSR bundle (`virtual:droplets-config`), the prerender or `vite dev`. `app.ts:10`, `app.ts:849`, `../server/app.ts:115`, `entry-server.ts:383`
- Without `tokens`, a stored render is served as stored, a live one as rendered, and a build stores renders without a nonce. `app.ts:1241`, `app.ts:1261`, `app.ts:1398`

### Fragment markup (`element.ts`)

- The fragment element is `<djs-droplet>` unless `element` says otherwise. `app.ts:107`
- The fragment element carries `data-droplet`, and optionally `data-build`, `data-render-id`, `data-context` and `data-droplet-error`. `element.ts:59`
- Inline payloads are `<script type="application/text">` with `data-droplet-context` or `data-droplet-data`. `element.ts:44`
- The droplet's stylesheet link carries `data-droplet-style`. `element.ts:65`
- Server HTML sits in `<div style="display: contents" data-droplet-entry>`. `element.ts:66`
- Inline JSON escapes `<` as `<`. `app.ts:409`

### Server records and env

- `serverKey` is `<element>:<build>`, shared by `/index.js`, `$droplets/drop` and `$droplets/form`. `server-records.ts:27`
- `serverLocation` is the record's origin, else the build root `__DROPLETS_BUILD_ROOT__` from `import.meta.url`. `server-records.ts:48`
- The runtime env falls back to `process.env` where `process` exists. `env-store.ts:26`
- Request info uses `AsyncLocalStorage` through `process.getBuiltinModule`, never a Node import. `request-store.ts:39`
- A production server logs errors only, with `console.error`: a plain message, then the error as it is. `app.ts:707`, `app.ts:715`, `app.ts:738`, `app.ts:1606`, `app.ts:1618`, `entry-server.ts:227`
- Runtime warnings reach the logger only through `devLog` (`vite dev`, the build's prerender) or behind `import.meta.env.DEV` (`entry-server.ts`), so a production bundle holds neither. `app.ts:175`, `entry-server.ts:123`, `entry-server.ts:348`
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
