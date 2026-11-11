`src/runtime`: the code a droplets server and a droplet in the browser run: the Hono app (`createDropletsApp`), `$droplets/server`, form actions and the custom element (`/index.js`).

## Rules

- Every module here uses web APIs only; Node built-ins are reached only through `process.getBuiltinModule` behind a check, never imported.
  Checked by: `../../test/portability.test.ts` (`NEUTRAL` lists `runtime`).
- Dev code lives in `dev-*.ts` and reaches production code only through the one `if (import.meta.env.DEV) installDevElement(...)` gate in `entry-client.ts`; the element class body holds no dev members.
  Checked by: `../../../../tests/dev-mixed/test/production.test.ts` (add a marker to `DEV_MARKERS` when you add dev code).
- The server side logs errors only, with plain `console.error`; a warning goes through the app's `devLog` (`dev-log.ts`, passed by `vite dev` and the prerender), or behind `import.meta.env.DEV` in modules only Vite runs (`entry-server.ts`). Modules the plugin runs in Node (`app.ts`, `security.ts`, `form-token.server.ts`) never read `import.meta.env`.
  Checked by: `../../../../tests/dev-mixed/test/production.test.ts` (`DEV_MARKERS`), `../../test/runtime/app.test.ts` ("what a production server logs").
- Dev modules (`dev-*.ts`) have no top-level side effects, so they tree-shake.
  Checked by: `../../../../tests/dev-mixed/test/production.test.ts`, `../../../../tests/packages/test/packed.test.ts`.
- `*.server.ts` modules (`form-token.server.ts`) are imported only by server code and never reach a client bundle.
  Checked by: `graphCheck()` in `../../tsdown.config.ts`, `../../../../tests/packages/test/packed.test.ts`.
- Input endpoints read plain data only: `FormData` or `JSON.parse`, no revivers.
  Checked by: `../../test/runtime/actions.test.ts`, `../../test/runtime/app.test.ts`.
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
- `handle` never runs for `/index.js`, `/env.js` and `/assets/*`.
  Checked by: `../../test/runtime/app.test.ts` ("never runs for files: /index.js and everything under /assets/", "createDropletsApp: /env.js").
- `/env.js` takes no input from the request and holds only the declared `public: true` variables without `static`, read through `readRuntimeEnv`; `DROPLETS_ENV_MAX_AGE` warns only through `devLog`.
  Checked by: `../../test/runtime/app.test.ts` ("createDropletsApp: /env.js"), `../../test/integration/vite.test.ts` ("/env.js").
- Every URL a droplet emits for its own files (`client.js`, `style.css`, its CSS and entry preloads) is on the droplet location of the request.
  Checked by: `../../test/runtime/app.test.ts` ("createDropletsApp: file URLs of the server bundle"), `../../test/integration/assets.test.ts`.
- The element, `$droplets/drop` and `$droplets/form` take the server location from `serverLocation` (`server-records.ts`), keyed `<element>:<build>`.
  Checked by: `../../test/runtime/entry-client.test.ts`.
- Request headers are `x-droplet-*` and response headers `x-droplets-*`.
- The server's fragment markup names the droplet with `data-droplet` and marks its payloads, style link and entry with `data-droplet-*`.
  Checked by: `../../test/runtime/element.test.ts`.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

Code style: `../../../../docs/style/code.md`.
