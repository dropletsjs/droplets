`src/runtime`: the code a droplets server and a droplet in the browser run: the Hono app (`createDropletsApp`), `$droplets/server`, form actions and the custom element (`/index.js`).

## Rules

- Every module here uses web APIs only; Node built-ins are reached only through `process.getBuiltinModule` behind a check, never imported.
  Checked by: `../../test/portability.test.ts` (`NEUTRAL` lists `runtime`).
- Dev code lives in `dev-*.ts` and reaches production code only through the one `if (import.meta.env.DEV) installDevElement(...)` gate in `entry-client.ts`; the element class body holds no dev members.
  Checked by: `../../../../tests/dev-mixed/test/production.test.ts` (add a marker to `DEV_MARKERS` when you add dev code).
- The server side logs errors only, with `console.error`: `formatMessage(…)` of a registry entry (`../errors/`), then the error; a warning goes through the app's `devLog` (`dev-log.ts`, passed by `vite dev` and the prerender), or behind `import.meta.env.DEV` in modules only Vite runs (`entry-server.ts`). Modules the plugin runs in Node (`app.ts`, `security.ts`, `form-token.server.ts`) never read `import.meta.env`.
  Checked by: `../../../../tests/dev-mixed/test/production.test.ts` (`DEV_MARKERS`), `../../test/runtime/app.test.ts` ("what a production server logs").
- Dev modules (`dev-*.ts`) have no top-level side effects, so they tree-shake.
  Checked by: `../../../../tests/dev-mixed/test/production.test.ts`, `../../../../tests/packages/test/packed.test.ts`.
- `*.server.ts` modules (`form-token.server.ts`, `payload-encode.server.ts`) are imported only by server code and never reach a client bundle.
  Checked by: `graphCheck()` in `../../tsdown.config.ts`, `../../../../tests/packages/test/packed.test.ts`.
- Input endpoints read plain data only: `FormData` or `JSON.parse`, no revivers.
  Checked by: `../../test/runtime/actions.test.ts`, `../../test/runtime/app.test.ts`.
- What a droplet sends the browser passes the payload contract on every render (`payload-encode.server.ts`, server only, on the `graphCheck` server list): plain JSON plus the transported values, each listed under `transported`, inner values first; a payload without one is the plain JSON it always was. Only the browser decodes (`payload-decode.ts`, imported by `entry-client.ts` alone), walking own keys and in-range indices, names through a `Map`; the server never decodes what a request carries, and a form result going back to it (the signed no-JavaScript result, the `form` of a re-render after an enhanced form) is plain JSON or left out.
  Checked by: `../../test/runtime/payload-encode.test.ts`, `../../test/runtime/payload-decode.test.ts`, `../../test/runtime/payload-boundary.test.ts`, `../../test/runtime/actions.test.ts` ("sends a result holding a transported value back without its data").
- A name from the client reaches code only through a `Map` or `Object.hasOwn` (droplets, actions, `/api` methods, form tokens, enhance answers).
  Checked by: `../../test/runtime/actions.test.ts` (`__proto__`, `constructor`), `../../test/runtime/enhance.test.ts`, `../../test/runtime/cookies.test.ts`.
- The route, the droplet and the action are resolved before the body is read.
  Checked by: `../../test/runtime/actions.test.ts`, `../../test/runtime/app.test.ts`.
- A form token's MAC is verified with `crypto.subtle.verify` before its payload is parsed.
  Checked by: `../../test/runtime/form-token.test.ts`.
- Client input is copied, never merged into internal objects; a form token's data lands in null-prototype objects.
  Checked by: `../../test/runtime/actions.test.ts` ("lets __proto__ form fields and query keys pollute nothing"), `../../test/runtime/form-token.test.ts`.
- Every body and `x-droplet-props` has a size limit (413, 431).
  Checked by: `../../test/runtime/security.test.ts`.
- Errors leave only through `failure()` and `handleError`: a status and a message, never a stack.
  Checked by: `../../test/runtime/app.test.ts` ("createDropletsApp: handleError").
- Each input rule has a negative test: `__proto__` names, tampered and expired tokens, odd field names.
  Checked by: `../../test/runtime/actions.test.ts`, `../../test/runtime/form-token.test.ts`, `../../test/runtime/security.test.ts`.
- The droplet location is resolved once per request: with `location` it is that value and no location header is read; without, `resolveLocation` trusts a location header only against the allow-list (`trustedOrigins`/`DROPLETS_TRUSTED_ORIGINS`, the request's own origin), else it is the request's own origin; `"*"` warns and is never refused.
  Checked by: `../../test/runtime/app.test.ts` ("createDropletsApp: the droplet location", `"*"`, "createDropletsApp: a fixed location").
- With `host`, `event.host` stays on its origin: the reported page's path and query only when that page is on it, never `Origin`; `host` joins the form-post and redirect allow-lists, never location trust.
  Checked by: `../../test/runtime/app.test.ts` ("createDropletsApp: a fixed host"), `../../test/runtime/actions.test.ts` ("lets an action redirect to the fixed host").
- Every `redirect()` the app answers goes through one check (`redirectTarget` over `redirectOrigins`, the 400 through `offSiteRedirect`): a load's, `transform`'s, `handle`'s and an action's target resolved against `event.host`, an endpoint's against `event.url`, answered absolute and only on the request's own origin, the location's, a trusted origin or `host`; `"*"` never counts.
  Checked by: `../../test/runtime/app.test.ts` ("createDropletsApp: a redirect a droplet answers"), `../../test/runtime/actions.test.ts` ("checks a redirect's target the same way for a JSON answer and an HTML one").
- `app.ts` never imports `host-tokens.ts` at runtime: the replacers reach it as the internal `tokens` option, and a build with `location` and `host` both set bundles none.
  Checked by: `../../../../tests/dev-mixed/test/production.test.ts` ("a production build with location and host fixed"), `../../test/runtime/app.test.ts` ("createDropletsApp: without token replacers").
- `handle` never runs for `/index.js`, `/index.css`, `/env.js` and `/assets/*`.
  Checked by: `../../test/runtime/app.test.ts` ("never runs for files: /index.js, /index.css and everything under /assets/, public/ included", "createDropletsApp: /env.js").
- `event.fetch` (`event-fetch.ts`) dispatches a URL on this server (relative, on the request's own origin, or under the location with its prefix) into the same app as a request of its own, so every check above runs for it unchanged (the location trust, the origin check, the limits, `handle`, the redirect bound), with the incoming `cookie`, `authorization` and location and `Origin` headers carried unless `init` sets them, and stops after four nested requests; any other URL goes to the global `fetch` with `init` alone, never with the incoming cookies or `authorization`. Header copying goes through `Headers`, never an object.
  Checked by: `../../test/runtime/event-fetch.test.ts` ("a URL on this server", "any other URL", "what being internal does not grant"), `../../test/integration/vite.test.ts` ("answers a load's event.fetch").
- `/env.js` takes no input from the request and holds only the declared `public: true` variables without `static`, read through `readRuntimeEnv`; `DROPLETS_ENV_MAX_AGE` warns only through `devLog`.
  Checked by: `../../test/runtime/app.test.ts` ("createDropletsApp: /env.js"), `../../test/integration/vite.test.ts` ("/env.js").
- Every URL a droplet emits for its own files (`client.js`, `style.css`, its CSS and entry preloads) is on the droplet location of the request.
  Checked by: `../../test/runtime/app.test.ts` ("createDropletsApp: file URLs of the server bundle"), `../../test/integration/assets.test.ts`.
- The element, `$droplets/drop` and `$droplets/form` take the server location from `serverLocation` (`server-records.ts`), keyed `<element>:<build>`.
  Checked by: `../../test/runtime/entry-client.test.ts`.
- `render.timeout`'s deadline is told from any other abort only by the brand on its reason (`isRenderTimeout`, `render-timeout.ts`, server only), never by a reason's name or message; the prerender has none.
  Checked by: `../../test/runtime/app.test.ts` ("createDropletsApp: render.timeout"), `../../test/runtime/render-timeout.test.ts`.
- With `fileHeaders`, a path the table matches takes its headers from the table alone: they are set inside `handle` on a 2xx or 304 answer, and the `cors` middleware is skipped for it.
  Checked by: `../../../adapters/node/test/app.test.ts` ("keeps a restricted cors off the build files"), `../../test/runtime/file-headers.test.ts`.
- Request headers are `x-droplet-*` and response headers `x-droplets-*`.
- Every markup attribute this folder reads or writes is `data-droplet` (the id) or `data-droplet-*`: the fragment's `data-droplet-build`, `data-droplet-render`, `data-droplet-context`, `data-droplet-error`, `data-droplet-payload="context"|"data"`, `data-droplet-style` and `data-droplet-entry`; the host's `data-droplet-props`, `data-droplet-context`, `data-droplet-hydrate` and `data-droplet-enhance`; the dev toasts' `data-droplet-key`.
  Checked by: `../../test/runtime/element.test.ts` ("writes data-droplet and data-droplet-* attributes, nothing else"), `../../../../tests/packages/test/attributes.test.ts`.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

Code style: `../../../../docs/style/code.md`.
