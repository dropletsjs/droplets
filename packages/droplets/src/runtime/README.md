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
<djs-droplet data-droplet="counter" data-droplet-props='{"start":3}'></djs-droplet>
```

## Details

### Files

| File | What it is |
|---|---|
| `app.ts` | `createDropletsApp`: the middleware chain and every route. |
| `host.ts`, `web-url.ts` | The droplet location from request headers, `event.host`, a fixed `host`. |
| `host-tokens.ts` | The host and location tokens of a build and their replacement per request; only a build that computes either per request bundles it. |
| `security.ts` | The origin (CSRF) check, the body size limits, `DROPLETS_TRUSTED_ORIGINS`. |
| `event-fetch.ts` | `event.fetch`: a URL on this server dispatched into the app in-process, any other to the global `fetch`. |
| `dev-log.ts` | The runtime's warnings, for `vite dev` and the build's prerender; a production server has none. |
| `cookies.ts` | `event.cookies`: parse, serialize, defaults, read-only and prerender jars. |
| `form.ts`, `form-token.server.ts`, `enhance.ts` | Form actions: action URLs, reserved query keys, the signed no-JavaScript result, `enhanceDropletForm`. |
| `element.ts` | The fragment markup the server writes. |
| `entry-server.ts`, `load.ts`, `props.ts`, `load-headers.ts` | The server bundle's registry, `load`, props validation, `setHeaders`. |
| `server.ts` | `$droplets/server`: `error`, `redirect`, `fail`, `json`, `text`, `sequence`, the event types. |
| `server-records.ts` | Per element and build: where `/index.js` was served from, the public env. |
| `entry-client.ts`, `client-init.ts` | `/index.js`: the custom element and `hooks.client` `init()`. |
| `stale.ts` | `droplets:stale`: its detail and the dispatch, for the element and for an enhanced form. |
| `request-store.ts`, `env-store.ts`, `base64.ts`, `routes.ts` | Per-request info, the runtime env, base64, `/api` route matching. |
| `dev-element.ts`, `dev-notify.ts`, `dev-tool.ts` | Dev only: HMR strategies, toasts, the dev tool hookup. |

### Routes

| Route | Answer |
|---|---|
| `GET /health` | `ok` (path from `health`, `false` turns it off). |
| `GET /` | What `loadIndex` returns: in a build the `index` file (by default `index.html` in the root, or a placeholder page without one), under `vite dev` the devtools page; 404 with `index: false`. |
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
- `Vary` on fragments and `_data` lists `x-droplet-location`, `forwarded`, `x-forwarded-host`, `x-forwarded-proto`, `x-forwarded-port`, `x-forwarded-prefix` and `origin`; with `location`, `origin` alone; then `accept-encoding` (not on a redirect or a form action's JSON); each name once, case ignored, after what `cors()` appended (`perRequest` is the outermost middleware of both routes). `app.ts:441`, `app.ts:452`, `app.ts:946`
- CORS exposes `Link` and `x-droplets-build`. `app.ts:286`
- `x-droplets-build` carries the build hash on every fragment and `_data` answer, 404 and 405 included (`perRequest`), so the element learns of a stale build before it reads the status. `app.ts:971`
- `x-droplets-prerender-error: host` or `cookies` marks a 500 when a prerendered droplet reads the host, props, URL or cookies. `app.ts:683`
- `event.url` is the request's path and query under the location, prefix included (`https://shop.example/mfe/droplets/x?who=Ana`); the cookie jar's defaults (`secure`) are judged by the same URL (`publicUrl`). `app.ts:579`
- `event.host` is the `Origin` header (skipping `null`), else the location's origin. `host.ts:142`
- With `host`, `event.host` is its origin plus the reported page's path and query when that page is on it, else the origin alone; `Origin` is not read. `app.ts:1016`, `host.ts:158`
- A reported path is set on the fixed host's URL, never joined, so `//evil.example` stays a path. `host.ts:162`
- `host` joins `trustedOrigins` for the origin check and the action redirect allow-list, not for location trust. `app.ts:843`

### Middleware and `handle`

- `handle`, the body read, `event.host`, cookies and `event` are skipped for `/index.js`, `/index.css`, `/env.js` and `/assets/*`. `app.ts:356`, `app.ts:982`
- The health route answers `ok` before `handle` runs; its path defaults to `/health`. `app.ts:934`
- The request body is read only for a droplet that exists. `app.ts:987`
- A `handle` that throws answers through `handleError`, as text, or as JSON under `_data` and `/api`; its `redirect()` passes the redirect bound against `event.host`. `app.ts:1161`
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

### `event.fetch` (`event-fetch.ts`)

- Every server event has `fetch`: `RequestEvent` (`handle`, `+server`, `handleError`'s event), `LoadEvent`, `ActionEvent` and `TransformEvent`; `entries` and `DropletLoadEvent` have none. `server.ts:133`, `app.ts:755`, `app.ts:912`, `app.ts:1716`
- `event.fetch` is made once per request in the first middleware, with the request as received, its resolved location and a dispatch into the same app with the request's `env` and execution context. `app.ts:1019`
- A URL is internal when it is relative (resolved against `request.url`), on the request's own origin (path as written) or under the location, prefix included (prefix taken off; the location's origin outside its prefix is not internal); `internalPath` decides. `event-fetch.ts:44`
- Any other URL goes to the global `fetch` with `input` and `init` as given and nothing of the incoming request. `event-fetch.ts:96`
- An internal request is dispatched through `app.fetch`: every middleware, the origin check, the body limits, `handle` (with fresh `locals`) and the route run for it as for a request from outside; a path no route matches answers 404 in-process. `event-fetch.ts:104`
- An internal request carries, each unless `init` sets it, the incoming `cookie` and `authorization` (not with `credentials: "omit"`) and `x-droplet-location`, `forwarded`, `x-forwarded-host`, `x-forwarded-proto`, `x-forwarded-port`, `x-forwarded-prefix` and `origin` (`CONTEXT_HEADERS`, the headers fragments vary on). `event-fetch.ts:16`, `event-fetch.ts:27`, `event-fetch.ts:73`
- A `Request` input's method, headers and body (read as bytes) make the internal request; `init` overrides each. `event-fetch.ts:70`
- A `Set-Cookie` an internal answer carries stays on that response; the outer response gets none of it. `app.ts:1096`
- The depth of internal requests is kept per `Request` in a `WeakMap`; the request that would be the fifth throws `droplets: event.fetch("<url>") would be 5 internal requests deep (the limit is 4)`, cut to 200 characters of URL, answered as any other thrown error (500 through `handleError`). `event-fetch.ts:30`, `event-fetch.ts:97`
- While prerendering an internal request works the same, with no cookie to carry; an endpoint that reads cookies answers the build's 500 on that inner response without stopping the build. `event-fetch.test.ts`
- A location header on an internal request is trusted only against `trustedOrigins`, as on any request; `__proto__` as a header name is a header and nothing else (`Headers`, never an object). `event-fetch.test.ts`

### Props

- Fragment props come from the query minus the reserved keys, else from the base64 `x-droplet-props` header. `app.ts:386`
- A malformed `x-droplet-props` (bad base64 or JSON, not an object, not plain JSON, nested past 64 levels) is ignored; under `vite dev` it warns `ignoring malformed x-droplet-props header`. `app.ts:405`, `app.ts:411`, `dev-log.ts:69`
- Props from a JSON body or `x-droplet-props`, and `form` from a JSON body, reach user code through `plainJson` (`plain-json.ts`): a copy with ordinary prototypes and no own `__proto__` key, refused past 64 levels or for anything `JSON.parse` could not produce. `plain-json.ts:13`, `app.ts:342`, `app.ts:411`
- POST props for a render come from the JSON body (`props`, `context`); an action POST takes them from the query. `app.ts:798`
- The JSON body is read only for POST whose parsed media type `isJsonType` takes (`application/json` or `+json`, the reading `limitFor` uses; `text/xml; a=application/json` is not one); malformed JSON gives no props. `app.ts:334`, `security.ts:135`
- Reserved query keys are `__cb`, `c`, `t`, `noSSR`, `clientOnly`, `__droplet_return`, every key starting with `/` and every key starting with `__droplet_form_`. `form.ts:26`
- `clientOnly` and `noSSR` in the query count by presence. `app.ts:787`
- Props validation errors (`PropsError`) answer 400 with `Invalid props: …`. `entry-server.ts:143`
- `propsKey` sorts keys, so props differing only in key order share a prerender entry. `props.ts:90`

### Fragments: `GET|POST /droplets/:id`

- An unknown droplet answers 404 before any method check, on the fragment and `_data` alike: `Not Found` as text, `{ "message": "Not Found" }` on `_data` (`notFound`). `app.ts:365`, `app.ts:813`, `app.ts:1321`
- A method other than GET and POST (HEAD is Hono's GET without a body, OPTIONS is `cors()`'s) on a known droplet answers 405 with `allow: GET, POST`, text on the fragment and `{ "message": "Method Not Allowed" }` on `_data`, before any body is read (`renderMethods`). `app.ts:372`, `app.ts:1321`
- A path no route matches answers 404 through one `app.notFound`: `{ "message": "Not Found" }` under `_data` and `/api` (`wantsJson`), text elsewhere; a trailing slash (`/droplets/x/`) is such a path, and its body is never read (`RENDER_ROUTE`). `app.ts:360`, `app.ts:864`, `security.ts:92`
- A droplet name in the URL is decoded; a malformed escape names no droplet. `app.ts:766`
- The droplet registry is a `Map`, so `__proto__` names no droplet. `entry-server.ts:57`
- A registry entry's `component` and `error` are thunks, like `load` and `serverLoad`: `renderDroplet` and `renderError` await them before anything else, so a component that fails to import is answered as an error of its own, never through the error page. `entry-server.ts:44`, `entry-server.ts:336`, `entry-server.ts:367`
- A POST with a form body runs an action, `text/plain` answers 415, and a `?/name` key with a non-form body answers 400. `app.ts:1680`
- A prerendered fragment is looked up by host key (origin and path), then, with `host`, by the origin-only key, then by props key. `app.ts:1234`, `app.ts:1237`, `app.ts:1238`
- `prerenderKey` is `<propsKey> <origin><path>`, `<propsKey> <origin>` for a render for `host` of the config, or `<propsKey>` for a host-agnostic one. `props.ts:103`
- A prerendered lookup for a droplet with `ssr = false` and no entry for these props answers 404. `app.ts:1239`
- The fragment's context script is written only when the answer has server markup, rendered live or stored at build whatever `ssr` says; without markup (`ssr = false`, `?noSSR`, `?clientOnly`) the context goes on `data-droplet-context`. `app.ts:1591`
- A fragment of a droplet with `hydrate = false` carries no context, neither the script nor `data-droplet-context`, its error page included; only its markup (and its stylesheet link). `app.ts:1590`
- Under `vite dev`, `withDevContext` in `vite/dev.ts` writes `data-droplet-context` onto a fragment that carries no context, from the host and props its `transform` ran with, for the dev remount; the runtime app knows nothing of it, so a production server bundles none of it. An `ssr = false`, `hydrate = false` fragment has no markup, so no `transform` runs and it stays bare. `../vite/dev.ts:52`
- `data-droplet-payload="data"` is written only when the droplet hydrates and the request is not `clientOnly`. `app.ts:1498`
- `data-droplet-render` is written only when there is server HTML. `app.ts:1497`
- A failed render answers 500 with the error component, else the action's status, else 200. `app.ts:1506`
- A response carrying a form result gets `cache-control: private, no-store`. `app.ts:1489`
- `fragmentCacheControl` defaults to `private, no-store, no-transform` and is set only on a 2xx answer that has none; an error, a 404, a 405 and a redirect carry no default (`perRequest`). `../core/config.ts:210`, `app.ts:1050`
- `perRequest` adds `no-transform` to the `Cache-Control` of every fragment and `_data` answer but a redirect and a form action's JSON (`isAction`), and gzips them through `gzipAnswer` (`compress.ts`), never at build. `app.ts:1056`, `app.ts:1064`, `app.ts:1686`, `compress.ts:100`
- The 303 of a native post that carries the signed result back to the page is `private, no-store`. `app.ts:1698`
- The `Link` header preloads `style.css` (only with styles), each CSS file and the entry, and modulepreloads `client.js` only when `hydrate === true`. `app.ts:1329`
- `linkHeader: false` drops the `Link` header. `app.ts:1334`
- `client.js` and `style.css` URLs in a fragment carry `?c=<build>`. `app.ts:1317`
- The origin check counts a POST, PUT, PATCH or DELETE as form-capable when it is form-urlencoded, multipart or `text/plain`. `security.ts:33`
- Every URL a fragment emits for its own files is built on the droplet location. `app.ts:1330`

### `_data`

- `_data` answers `{ data }`, plus `form` when a result is carried. `app.ts:1303`
- `_data` answers a failed load with 500 `{ error }`. `app.ts:1301`
- `_data` answers PUT, PATCH and DELETE with 405 and `allow: GET, POST`, as the fragment does (`renderMethods`). `app.ts:1321`
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
- An unknown action answers 404 `No action named "<name>"`, the name cut to 100 characters, when the name matches `ACTION_NAME`; any other name answers 404 `No such action` without echoing it. `app.ts:1582`
- Action names match `^[A-Za-z_][\w-]*$`. `form.ts:141`
- An action is found only through `ACTION_NAME`, a deny list (`__proto__`, `constructor`, `prototype`) and `Object.hasOwn`. `entry-server.ts:316`
- An action answers JSON when `accept` prefers it over HTML (`prefersJson`): `application/json` or `application/*` with a weight at least `text/html`'s, never through `*/*` alone. `app.ts:1588`, `accept.ts:47`
- A JSON action answer is the outcome with the failure's status, else 200. `app.ts:1630`
- An action redirect, native or JSON, goes only to this server or a trusted origin (`redirectTarget`, the same check in both modes and the same as a load's or `handle`'s), else 400 `Bad Request: the action redirects off this site` (as `{ message }` in JSON) and a `console.error` (`offSiteRedirect`). `app.ts:677`, `app.ts:1690`
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
- A form token's data is copied into null-prototype objects (`plainJson` with `nullPrototype`). `form-token.server.ts:192`

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
- A thrown `HttpError` answers its status and message; a thrown `Redirect` answers its target absolute, resolved against `event.host` for a load, `transform` or `handle` and against `event.url` for a `+server` route, only when its origin is the request's own, the location's, a trusted origin or `host` (`redirectTarget` over `redirectOrigins`, `"*"` never counts), else 400 `Bad Request: the droplet redirects off this site` (`handle`, `the endpoint` for those) as text or `{ message }` by the route, logged once with `console.error`. `app.ts:646`, `app.ts:677`, `app.ts:811`
- Any other thrown error is logged and answers 500 with `handleError`'s message, never a stack. `app.ts:727`
- What no handler caught goes to Hono's `onError`, which answers through `failure` and `handleError` too: JSON for `_data` and `/api/*`, text elsewhere, logged as `request failed: <path>`. `app.ts:847`
- The log line of a failure names where it failed, then the path once: `droplet failed: /droplets/x`, `endpoint failed: /api/x`, `action <name> failed: …`. `app.ts:739`, `app.ts:1734`
- The fragment's context is serialized inside the render's `try`, so a value `JSON.stringify` refuses answers through `handleError`. `app.ts:1489`
- Without `handleError`, production renders answer `Internal Error`. `load.ts:40`

### `/api`

- `/api` without a matching route answers 404 `{ "message": "Not Found" }`, through the same `notFound`. `app.ts:1735`
- `/api` accepts GET, POST, PUT, PATCH, DELETE, OPTIONS and HEAD. `routes.ts:6`
- `/api` HEAD falls back to GET with a null body. `app.ts:1696`
- `/api` picks the handler of an HTTP method's name through `Object.hasOwn`; `fallback` takes every method the module does not export, a non-standard one (`FOO`) included; an export of any other name (`CONFIG`) is never called. `app.ts:1751`
- `/api` answers an unhandled method with 405 `{ "message": "Method Not Allowed" }` and `allow` listing the exported methods, omitted when there is none. `app.ts:1753`
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
- The fragment element carries `data-droplet`, and optionally `data-droplet-build`, `data-droplet-render`, `data-droplet-context` and `data-droplet-error`. `element.ts:59`
- Inline payloads are `<script type="application/text">` with `data-droplet-payload="context"` or `data-droplet-payload="data"`. `element.ts:44`
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

- The element reads props from the inline context script, then `data-droplet-context`, then `data-droplet-props` (plain JSON); a payload that does not parse is logged and the next one is read. `entry-client.ts:480`
- `updateForm({ form, action })` on a droplet that is not hydrated asks for its fragment again with the props and page of `action`, the URL of the action that answered, as a form posted without JavaScript has them: the query's keys minus the reserved ones and `__proto__`, the first of a repeated key, as strings, in a null-prototype object; the page from `__droplet_return`, the browser's own URL (query kept) when it is that page. `entry-client.ts:1415`
- An `action` that is not this droplet's own (`ownAction`: another origin or path, credentials, no URL) gives no props; the element's own context is used, as without an `action`. `entry-client.ts:1423`
- `enhanceDropletForm` hands `updateForm` the action URL it posted to. `enhance.ts:381`
- The element's server location is `serverLocation` for its element and build. `entry-client.ts:368`
- `_data` is fetched with POST to `<location>/droplets/<id>/_data?__cb=<now>`, a JSON body and `redirect: "manual"`. `entry-client.ts:721`
- `data-droplet-hydrate` takes `""`, `true`, `false`, `visible` and `interactive`, case-sensitive. `entry-client.ts:1097`
- `data-droplet-hydrate="false"` never stops a script droplet. `entry-client.ts:1106`
- `interactive` without server markup hydrates at once. `entry-client.ts:1114`
- `visible` uses a 200px root margin, 1000px without markup. `entry-client.ts:189`
- `interactive` waits for `pointerdown`, `focusin`, `keydown` or `click`. `entry-client.ts:192`
- Clicks before hydrate are captured, and dropped instead of replayed after 1500 ms of waiting or once 10 s old. `entry-client.ts:680`
- A held click records its node's child-index path from the content root; when hydration replaced the node, it replays on the element at that path if it has the same tag, else it is dropped. `entry-client.ts:225`, `entry-client.ts:727`
- A second click within 400 ms of the first counts as a retry, not a new click. `entry-client.ts:626`
- A build mismatch keeps the server HTML and dispatches `droplets:stale` (bubbles, composed) through `reportStale` of `stale.ts`, the same dispatch an enhanced form uses. `entry-client.ts:766`, `stale.ts:33`
- An answer to `_data` or to a fragment request from another build (`x-droplets-build`) is reported as stale before its status or body is read, so a 404 from a newer build is never taken for a missing droplet; the fragment stays as it is. `entry-client.ts:806`, `entry-client.ts:1388`
- An unknown droplet keeps its markup and does nothing. `entry-client.ts:1165`
- Host children go into `[data-droplet-slot]` or replace `[data-droplet-children]`, moved with `moveBefore` when available. `entry-client.ts:180`
- With several markers, the container lives in the first connected one in document order, at connect among the server's and after `fill` among the reported ones, whichever was reported first; `empty` moves it to the next, else parks it. `entry-client.ts:562`
- `data-droplet-enhance` on a form opts it into `enhanceDropletForm`. `entry-client.ts:1266`
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
- `enhanceDropletForm` reads `x-droplets-build` before the answer's body, as the element does; an answer from another build dispatches `droplets:stale` on the droplet's element (`reportStale`, `stale.ts`) and applies nothing: no `updateForm`, no `onResult`, no `droplets:action`. `enhance.ts:357`
- `actionTarget()` gives the loader's build with the droplet and the location, so an enhanced form can tell an answer from another build. `entry-client.ts:1262`
- `enhanceDropletForm` follows only an absolute http(s) redirect location without credentials, as the server answers one; a relative, protocol-relative (`//…`, `/\…`) or `javascript:` one is logged and not followed. `enhance.ts:240`, `enhance.ts:365`

### `hooks.client`

- `init()` that is not a function logs an error; a rejection or throw is logged, never awaited. `client-init.ts:44`

### Dev

- Dev strategies come from `?strategy=`, then `sessionStorage` `droplets:strategy:<origin>`, then the config. `dev-element.ts:222`
- Dev follows `droplets:update`, `vite:beforeUpdate`, `droplets:hooks-client` and `droplets:hot-fallback`. `dev-element.ts:659`
- Dev toasts show at most 3, and a toast without a reload button closes after 10 s. `dev-notify.ts:94`
- The dev tool is injected per `?injectTool=` (anything but `false` injects), else per the config. `dev-element.ts:738`
- A second `/index.js` of one server from another build warns once in dev, naming the element and both builds (`serverBuilds`); in production it adopts the elements silently and the first build's code runs them. `dev-element.ts:183`, `entry-client.ts:1476`
- The dev remount tells a server fragment by its context, or by `data-droplet-build` with server markup; anything else mounts in the browser. `dev-element.ts:317`
- A dev toast carries `data-droplet-key`; a notification with the same key replaces the one shown. `dev-notify.ts:48`
