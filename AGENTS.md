# Working on Droplets

Droplets: server-rendered components any stack can embed, as a Vite 8 plugin on Hono.
`CONTRIBUTING.md` is the long form; `DESIGN.md` logs decisions as they were taken (the docs win where they differ).
Every folder of interest has its own `AGENTS.md` with that folder's rules and a `README.md` with its facts; the rules here are the ones that hold across packages, apps, examples and tests.

## Layout

- `packages/droplets`: `@dropletsjs/droplets`, the Vite plugin, the runtime, the `djs` bin (`djs sync`, `djs add`).
- `packages/devtools`: `@dropletsjs/devtools`, the dev page on `/` and the in-page dev tool. Dev only.
- `packages/adapters/{node,cloudflare,bun,deno}`: `@dropletsjs/adapter-*`. `vite build` requires one.
- `packages/renderers/{svelte,vue,react,preact,solid,hono-jsx,handlebars,lit}`: `@dropletsjs/renderer-*`.
- `packages/create-droplets`: `create-droplets` (unscoped), `npm create droplets`.
- `packages/shared`: `@dropletsjs/shared`, private, never published. `./tsdown` (`base`, `cssInline()`, `graphCheck()`), `./tsconfig.base.json` (extend it by that file path, which resolves with or without `exports`), `./vitest` (`rendererTests`, `adapterTests`, `happyDom`, `FIXTURE_ROOT`, `buildFixtureApp()`, `waitForServer()`), `./env` (`loadEnvLocal()`).
- `apps/docs`: the guide, Astro Starlight. `apps/demo`: the live droplets the guide embeds; it trusts only the docs' origins.
- `examples/frameworks/*`: one project per renderer, the same three droplets each. A change to one usually belongs in all.
- `examples/shop`, `examples/wp-shop`: the shop demo, on SQLite and on WordPress.
- `examples/hosts/*`: host stacks, outside the pnpm workspace (own toolchains, Docker Compose).
- `tests/*`: end-to-end tests across packages. A package's own tests live in its `test/`.
  `examples` (Playwright), `hosts` (Docker; `test/` static checks over `examples/` without it), `create-droplets`, `djs-add`, `dev-mixed` (`vite dev` + HMR, and the production build), `packages` (the packed tarballs).

## Where things go

- **Shared** (used by more than one package, app or test): `packages/shared`. Import it by package name (`@dropletsjs/shared/tsdown`).
- **Unique** (used by one place): that place's own folder.
- **Root**: repo management only. Workspace and lockfile, `.github`, `.changeset`, `LICENSE`, `README`, `CONTRIBUTING`, `SECURITY`, `CODE_OF_CONDUCT`, `AGENTS.md`, `CLAUDE.md`, ignore files, the root `package.json` scripts.
  Also `DESIGN.md` (decisions across the packages), `.env.example` (the root `.env.local`, read by `tests/hosts`, the Bun and Deno suites and the shop's scripts) and `.dockerignore` (the Dockerfiles build from the root).
- **Examples** (`examples/*`): standalone, because users copy them. They depend on published packages only.

## Verify a change

```bash
pnpm install --frozen-lockfile
pnpm build            # every package with tsdown and its unit tests, in dependency order
pnpm check            # biome ci, build, typecheck, tests/*, framework examples (Node + Cloudflare), shop + wp-shop, apps/demo
pnpm test:e2e         # builds examples/frameworks/*, runs tests/examples in Chromium
pnpm docs:build       # builds and starts apps/demo, then astro build (fails without the demo)
pnpm docs:check-csp   # after docs:build: every inline script hash is in apps/docs/public/_headers
pnpm typecheck:hosts  # npm ci + npm run typecheck in each Node host (examples/hosts/*, outside the workspace)
```

`pnpm test` = vitest over `packages/**` and `tests/**`; `pnpm test:integration` = `tests/**` only, what `check` runs after `build`. `pnpm test:hosts [host…]` needs Docker and the gitignored `.env.local` (see `.env.example`). CI (`.github/workflows/ci.yml`) runs `check`, `docs:build`, `docs:check-csp`, `test:e2e`, `typecheck:hosts` and a Docker smoke test.

## Rules

Each rule states what holds, then what checks it. A rule that one folder alone can break lives in that folder's `AGENTS.md`.

### Bundles

1. **A browser bundle holds browser code only.** Every chunk a client entry reaches is free of `*.server.*` files, `+server.*` routes, files under a `server/` folder (in any case), the listed server modules and Node built-ins, in our packages and in user projects, in `vite build` and in `vite dev`, through any import chain; the refusal names the chain.
   Checked by: `graphCheck({ client, server })` from `@dropletsjs/shared/tsdown` in every `tsdown.config.ts`; `tests/packages/test/packed.test.ts` ("keeps server code out of what the client entries reach"); for user projects `packages/droplets/src/vite/server-only.ts`, `packages/droplets/test/integration/server-only.test.ts` ("ignores case in the name and the folder").
2. **A production build holds the application alone.** Dev and HMR code renders to nothing in any chunk, for every renderer and every adapter, Cloudflare's single `worker.js` included. A production server logs errors only, with plain `console.error`; every warning and the logger (`core/logger.ts`) belong to `vite dev` and `vite build`.
   Checked by: `tests/dev-mixed/test/production.test.ts` (`DEV_MARKERS`, `DEV_MODULE`); `packages/droplets/test/runtime/app.test.ts` ("createDropletsApp: what a production server logs").
3. **Development code is its own module and enters production code through one gate.** It lives in `runtime/dev-*.ts` or a renderer's `client-dev.ts`, has no top-level side effect, and a class reaches it through at most one `if (import.meta.env.DEV) installDev…(Class)`. `import.meta.env.DEV` and `import.meta.hot` stay literal in `dist/`, so the consumer's Vite strips the dev path. New dev code adds its marker to `DEV_MARKERS`.
   Checked by: `tests/dev-mixed/test/production.test.ts`; `tests/dev-mixed/test/dev-gate.test.ts` (the sources: who imports a dev module, the one `installDev…` call per class, nothing run at a dev module's top level); `tests/packages/test/packed.test.ts` ("leaves import.meta.env.DEV and import.meta.hot to the consumer's Vite").
4. **A package imports only what it declares.** Every import in `dist/` resolves to the package itself, a dependency, a peer, a Node built-in or a virtual id.
   Checked by: `graphCheck()` at build; `tests/packages/test/packed.test.ts` ("imports only its dependencies and peers, Node built-ins and virtual modules").
5. **A file the code finds by path in `dist/` is a tsdown `entry`, so its name stays fixed**, and each `tsdown.config.ts` names every entry and server module in its `graphCheck` lists.
   Checked by: `tests/packages/test/packed.test.ts` ("has every entry the code resolves by path at its fixed place, with its types").
6. **Runtime CSS is a `.css` file imported with `?inline`**; nothing in `dist/` imports a `.css` file.
   Checked by: `cssInline()` in each `tsdown.config.ts`; `tests/packages/test/packed.test.ts` ("keeps the JSDoc in the types, and no CSS import in any file").

### Runtime

7. **The runtime and core run on any JavaScript runtime.** `packages/droplets/src/runtime/`, `src/server/`, `src/core/config.ts` and `src/core/logger.ts` use web APIs only; Node lives in the adapters and the build tooling.
   Checked by: `packages/droplets/test/portability.test.ts` (`NEUTRAL`).
8. **The droplet location is resolved once per request: computed on demand, or fixed by `location`.** On demand, it is the location a header names (`x-droplet-location`, then `Forwarded`, then `X-Forwarded-*`) when that origin is the request's own or a `trustedOrigins` / `DROPLETS_TRUSTED_ORIGINS` entry, else the request's own origin; `"*"` is the owner's opt-in, warned about under `vite dev`, never refused. With `location` set, every request's location is that value, `vite build` writes it into the server bundle and no location header is read. `host` fixes the page the droplets render on and joins the form-post and redirect allow-lists, never location trust; with both set, a build holds no host or location token. Every URL a droplet emits for its own files (`client.js`, `style.css`, imported and public files) is on that location, prefix included, so a droplet works under any origin and behind any proxy. A redirect a droplet answers passes the same bound for a JSON answer as for an HTML one.
   Checked by: `packages/droplets/test/runtime/app.test.ts` ("createDropletsApp: the droplet location", "createDropletsApp: a fixed location", "createDropletsApp: a fixed host", "file URLs of the server bundle"), `test/runtime/security.test.ts`, `test/runtime/actions.test.ts` ("checks a redirect's target the same way for a JSON answer and an HTML one"), `test/integration/assets.test.ts`, `test/integration/prerender-host.test.ts`, `tests/dev-mixed/test/production.test.ts` ("a production build with location and host fixed"), `tests/examples/e2e/examples.spec.ts`.
9. **`/index.js`, `/index.css` and `/assets/*` are files of the build, `/env.js` plain data.** `/index.js` and `/index.css` are the build's static files (`/index.css` an `@import` of the hashed shared stylesheet, absent without one), both `no-store`, `/env.js` carries only the declared runtime public variables and reads nothing from the request, `/assets/*` is the client build's `assets/` folder (`public/` under `/assets/public/*`); all four are answered before `handle`, so a host's one `/assets/*` proxy rule and one `handle` cover every server.
   Checked by: `packages/droplets/test/runtime/app.test.ts` ("createDropletsApp: handle", "createDropletsApp: /env.js"), `test/integration/index-js.test.ts`, `packages/adapters/node/test/static.test.ts`, `packages/adapters/cloudflare/test/worker.test.ts`.

### Endpoints (actions, props, the context round-trip, form tokens, `/api`)

10. **An endpoint takes input the same way everywhere**, in the packages, in `apps/demo` and in the examples:
    - plain data in and out: `FormData` or `JSON.parse`, plain JSON back; no devalue, superjson, Flight or revivers.
      Checked by: `packages/droplets/test/runtime/actions.test.ts`, `apps/demo/test/server.test.ts` ("plain data only").
    - the server chooses the code: a name from the client reaches a function only through `Object.hasOwn` on a plain object, a `Map` or a method allow-list.
      Checked by: `actions.test.ts` (`__proto__`, `constructor`), `test/runtime/enhance.test.ts`, `packages/adapters/node/test/assets.test.ts`.
    - the route, the droplet and the action are resolved before any body is read.
      Checked by: `actions.test.ts`, `apps/demo/test/server.test.ts` ("the code is resolved before the body is read").
    - a signed value is verified in constant time before what it signs is parsed.
      Checked by: `test/runtime/form-token.test.ts`.
    - client input stays an argument: validated and passed on, copied into null-prototype objects, never merged into an internal object; `__proto__` anywhere leaves `Object.prototype` untouched.
      Checked by: `test/runtime/security.test.ts` ("leaves Object.prototype alone for __proto__ in the body, the query and x-droplet-props"), `actions.test.ts`, `form-token.test.ts`.
    - every body and header has a size limit (413, 431).
      Checked by: `security.test.ts` ("body limits").
    - an error leaves only through `handleError`, as a status and a message.
      Checked by: `test/runtime/app.test.ts` ("createDropletsApp: handleError").
    - each of these has a negative test next to the endpoint: `__proto__` names, tampered and expired tokens, odd field names.
      Checked by: `actions.test.ts`, `form-token.test.ts`, `security.test.ts`.

### Authoring model

11. **A droplet uses one framework.** Its graph holds its own renderer's modules and framework-agnostic code; another configured renderer's files or packages fail `vite build` and the `vite dev` import, naming the chain. A script droplet has no framework and is exempt.
    Checked by: `packages/droplets/test/vite/renderer-graphs.test.ts`, `tests/dev-mixed/test/dev.test.ts`.
12. **The flags `ssr`, `hydrate` and `prerender` come from the droplet's component alone** (`+droplet.<ext>`, the Handlebars flags comment, the Svelte `<script module>`, the Vue plain `<script>`). A flag anywhere else is ignored; a mistaken flag warns under `vite dev` and `vite build` and is ignored. A script droplet is client only whatever it exports: `ssr` false, hydrated at once, never prerendered, each exported flag warned about once.
    Checked by: `packages/droplets/test/core/discover.test.ts`, `test/core/script.test.ts`, `test/integration/script.test.ts`, `packages/renderers/handlebars/test/index.test.ts`.
13. **The build fails only where it cannot produce a correct output; what the framework does not read is ignored.** Two cases are the contract itself: server code reached from a client bundle, and another framework's files or packages in a droplet, each refused with the import chain; the Handlebars flags comment is the framework's own syntax inside a string, so a misplaced, misspelled, repeated or non-literal flag there fails too. The other failures are inputs the build cannot do without or cannot make sense of: a missing adapter, an `index` file that does not exist, an invalid config value, a static env variable without a value, a stylesheet reached from a load file, two components or an unknown suffix in one droplet folder; each throws a `droplets:` message that names the fix. Everything else is ignored, with a warning under `vite dev` and `vite build` where the framework can see the mistake: a droplet folder that is not lowercase kebab-case (the folder is the droplet's id; the others are listed in one warning), an error page in another framework (once per file). A flag outside the component (`+droplet.ts`, `+droplet.server.ts`) is ignored without a word: those files are not read for flags.
    Checked by: `packages/droplets/test/integration/server-only.test.ts`, `test/vite/renderer-graphs.test.ts`, `packages/renderers/handlebars/test/index.test.ts`, `test/vite/build.test.ts` (the adapter), `test/vite/index-html.test.ts`, `test/core/config.test.ts`, `test/core/env.test.ts`, `test/integration/load-css.test.ts`, `test/core/discover.test.ts` ("ignores every droplet folder that is not lowercase kebab-case, warning once with the list", "warns once about an error page in another framework in a build too, and never fails it", "ignores a flag exported from %s, in a build and in dev").
14. **Every renderer passes the renderer contract.** `rendererConformance()` from `@dropletsjs/droplets/testing` runs in each renderer's `test/conformance.test.ts`: the server in a worker thread of its own, the browser side in happy-dom, with queries that reach into shadow roots and comparisons that ignore an engine's comment markers. What only a real browser shows of Lit (the parser's declarative shadow roots, styles inside the shadow root, the replayed click) is checked in Chromium as well.
    Checked by: `packages/renderers/*/test/conformance.test.ts`, `packages/droplets/test/conformance.test.ts`, `tests/examples/e2e/lit.spec.ts`.
15. **Public API changes with the maintainer's go and its docs page in the same change.** Public API is what a user calls, configures or embeds: config options, routes, the element contract, the renderer and adapter contracts, `$droplets/*` modules, the entries' exported functions and classes, the `djs` and `create-droplets` commands and what they write. A type that is only exported is a convenience for the user's own code, not API on its own.
    Checked by: review; `apps/docs/` carries the matching page.

### Names and layout

16. **One vocabulary across servers, hosts and docs.** Markup attributes are `data-droplet-*`; request headers `x-droplet-*`, response headers `x-droplets-*`; framework modules `$droplets/*`, and `#` stays the user's subpath imports. Droplets live in `src/droplets/<id>/+droplet.*`, their routes under `/droplets/:id` (`/_data`, `/client.js`, `/style.css`), and `/api/` is reserved. A thing is named for what it is (`errorComponent`, `createDropletsApp`).
    Checked by: `packages/droplets/test/runtime/element.test.ts` (`data-droplet-*`), `test/runtime/app.test.ts` (the routes); names: review.
17. **Code lives where it is used, and every project stands on its own.** Shared code is in `packages/shared`, imported by package name; code with one user is in that user's folder; the root holds repo management; `examples/*` depend on published packages only. Every workspace project declares each package, `@types/*` and tool its files use, and typechecks on its own. Tool versions live in the pnpm `catalog:` of `pnpm-workspace.yaml`, create-droplets reads the same ranges, and `minimumReleaseAge` is 7 days.
    Checked by: pnpm's isolated `node_modules` (`shamefullyHoist: false`), `pnpm typecheck` (`pnpm -r typecheck`), `pnpm typecheck:hosts`, `tests/hosts/test/standalone.test.ts` (no `file:`/`link:` range, no import or `tsconfig` above an example's folder), `packages/create-droplets/versions.ts` (throws on a missing catalog entry), `packages/create-droplets/test/files.test.ts`.
18. **Code style is `docs/style/code.md`** for TypeScript in `packages/*` and their tests; Biome formats and lints, and a review never comments on layout. A comment explains a non-obvious why.
    Checked by: `biome ci` in `pnpm check`; comments: review.

### Tests, docs, release

19. **A behaviour change comes with a test; a fix with a test that failed before it.** Every package runs its unit tests in `build` (so a failing suite stops `pnpm build` and `pnpm release`); `build:dist` only compiles; `tests/*` import `dist/` and run after `build`.
    Checked by: each package's `package.json` (`build`, `build:dist`); `pnpm check`.
20. **The docs state what the code does, per stack.** One page per framework and per host; a live droplet is a real one in `apps/demo/src/droplets/`; pages link with root-relative paths; every inline script hash is in `apps/docs/public/_headers`.
    Checked by: `pnpm docs:build`, `pnpm docs:check-csp`.
21. **The public packages version together.** They are one `fixed` changeset group in pre mode with the `alpha` tag; a user-facing change carries a changeset (`pnpm changeset`); every `CHANGELOG.md` is generated.
    Checked by: `.changeset/config.json`, `.changeset/pre.json`.
22. **CI runs on GitHub-hosted runners with `pull_request` and `push` triggers only.**
    Checked by: `.github/workflows/ci.yml`.
