# Working on Droplets

Droplets: server-rendered components any stack can embed, as a Vite 8 plugin on Hono.
`CONTRIBUTING.md` is the long form; `DESIGN.md` logs decisions as they were taken (the docs win where they differ).

## Layout

- `packages/droplets`: `@dropletsjs/droplets`, the Vite plugin, the runtime, the `djs` bin (`djs sync`, `djs add`).
- `packages/devtools`: `@dropletsjs/devtools`, the dev page on `/` and the in-page dev tool. Dev only.
- `packages/adapters/{node,cloudflare,bun,deno}`: `@dropletsjs/adapter-*`. `vite build` requires one.
- `packages/renderers/{svelte,vue,react,preact,solid,hono-jsx,handlebars,lit}`: `@dropletsjs/renderer-*`.
- `packages/create-droplets`: `create-droplets` (unscoped), `npm create droplets`.
- `packages/shared`: `@dropletsjs/shared`, private, never published. `./tsdown` (`base`, `cssInline()`, `graphCheck()`), `./tsconfig`, `./vitest` (`rendererTests`, `adapterTests`, `happyDom`), `./env` (`loadEnvLocal()`).
- `apps/docs`: the guide, Astro Starlight. `apps/demo`: the live droplets the guide embeds; it trusts only the docs' origins.
- `examples/frameworks/*`: one project per renderer, the same three droplets each. A change to one usually belongs in all.
- `examples/shop`, `examples/wp-shop`: the shop demo, on SQLite and on WordPress.
- `examples/hosts/*`: host stacks, NOT in the pnpm workspace (own toolchains, Docker Compose).
- `tests/*`: end-to-end tests across packages. A package's own tests live in its `test/`.
  `examples` (Playwright), `hosts` (Docker), `create-droplets`, `djs-add`, `dev-mixed` (`vite dev` + HMR, and the production build), `packages` (the packed tarballs).

## Where things go

- **Shared** (used by more than one package, app or test): `packages/shared`. Import it by package name (`@dropletsjs/shared/tsdown`), never by `../../` path.
- **Unique** (used by one place): that place's own folder.
- **Root**: repo management only. Workspace and lockfile, `.github`, `.changeset`, `LICENSE`, `README`, `CONTRIBUTING`, `SECURITY`, `CODE_OF_CONDUCT`, `AGENTS.md`, `CLAUDE.md`, ignore files, the root `package.json` scripts.
  Also `DESIGN.md` (decisions across the packages), `.env.example` (the root `.env.local`, read by `tests/hosts`, the Bun and Deno suites and the shop's scripts) and `.dockerignore` (the Dockerfiles build from the root).
- **Examples** (`examples/*`): standalone, because users copy them. They never depend on `packages/shared`.

## Verify a change

```bash
pnpm install --frozen-lockfile
pnpm build            # every package with tsdown and its unit tests, in dependency order
pnpm check            # build, typecheck, tests/*, framework examples (Node + Cloudflare), shop + wp-shop, apps/demo
pnpm test:e2e         # builds examples/frameworks/*, runs tests/examples in Chromium
pnpm docs:build       # builds and starts apps/demo, then astro build (fails without the demo)
pnpm docs:check-csp   # after docs:build: every inline script hash is in apps/docs/public/_headers
```

- Every package runs its unit tests in `build`, so a failing suite stops `pnpm build` and `pnpm release`.
  Tests that import the package's own `dist/` run after tsdown (`tsdown && vitest run`); the adapters and create-droplets need none and test first.
  `build:dist` (root and per package) only compiles: the Dockerfiles and CI's e2e job use it.
- `pnpm test` = vitest over `packages/**` and `tests/**`; `pnpm test:integration` = `tests/**` only, what `check` runs after `build`. Integration tests import `dist/`, so build first.
- `tests/packages` tests the published packages as `npm pack` writes them: entries at fixed paths, client entries never reach server code or Node built-ins, only declared deps imported, `import.meta.env.DEV` intact.
- Every renderer runs `rendererConformance()` from `@dropletsjs/droplets/testing`; a renderer contract change shows up there.
- `pnpm test:hosts [host…]` needs Docker. Local overrides go in the gitignored `.env.local` (see `.env.example`).
- Bun and Deno adapter suites are skipped when the binary is missing.
- CI (`.github/workflows/ci.yml`) runs `check`, `docs:build`, `docs:check-csp`, `test:e2e` and a Docker smoke test.
- A behaviour change needs a test. A fix needs a test that failed before it.

## Hard rules

1. **No dev or HMR code in a production bundle, not even private code** (`#methods` ship; minifiers can't drop them).
   - Gate it behind `import.meta.env.DEV`, which tsdown keeps literal so the consumer's Vite strips it, or put it in a module only dev imports (`runtime/dev-*.ts`, a renderer's `clientDev`).
   - Classes: production code may hold at most one `if (import.meta.env.DEV) installDev…(Class)` that extends or wraps the prototype from a dev module. No dev members, fields or branches in the class body.
   - Dev modules have no top-level side effects, so they tree-shake.
   - Enforced by `tests/dev-mixed/test/production.test.ts`. Add a marker to `DEV_MARKERS` when you add dev code.
2. **`*.server.*` and anything under `server/` never reach a client bundle**, in build and in `vite dev`, through any import chain.
   - User projects: the plugin refuses it. Our packages: `graphCheck({ client, server })` in each `tsdown.config.ts`.
   - Keep those lists in sync when you add or rename an entry or a server module.
3. **Endpoints that take input** (actions, props, the context round-trip, form tokens, `/api`) follow the React2Shell checklist in `DESIGN.md`:
   - plain data only: `FormData` or `JSON.parse`; no devalue, superjson, Flight or revivers;
   - the client never chooses code: `Object.hasOwn` lookups, `Map` registries, never `obj[id]`;
   - resolve the route, droplet and action before parsing the body;
   - verify a MAC (constant time) before parsing what it signs;
   - never merge client input into internal objects;
   - size limits; errors leave only through `handleError`, never with a stack;
   - a negative test for each rule (`__proto__` family, tampered tokens, odd field names).
4. **Comments only for a non-obvious why.** No narration, no comment per list entry or config key.
5. **New public API needs the maintainer's approval before it is implemented.** That covers config options, routes, the element contract, the renderer contract and `$droplets/*` modules. Public API changes come with a matching change in `apps/docs/`.

## Conventions

- Markup attributes are `data-droplet-*` (`entry`, `context`, `data`, `slot`, `style`, `children`, …). No `data-app-*`.
- Name things for what they are: `errorComponent`, not `errorPage`; `createDropletsApp`, not `createApp`.
- Droplets live in `src/droplets/<id>/+droplet.*`; routes under `/droplets/:id` (`/_data`, `/client.js`, `/style.css`); `/api/` is reserved.
- Framework modules use `$` (`$droplets/env`, `$droplets/server`); `#` is left to the user's subpath imports.
- One framework per droplet: a droplet that reaches another framework's files or packages fails the build and `vite dev`. Shared code goes in a framework-agnostic folder.
- Renderer contract: a server module rendering `{ data, form? }` or `{ error }`; a client module with `mount`, `hydrate`, `unmount`; optional `clientDev` with `update(instance, props)`; `packages` and `suffixes` for mixed projects. See `apps/docs/src/content/docs/renderers/index.mdx` ("Writing a renderer") and the API reference.
- `packages/droplets` runtime and core stay Node-free (`test/portability.test.ts`); Node lives in adapters.
- Runtime CSS lives in `.css` files imported with `?inline`, not in JS strings.
- A file the code finds by path in `dist/` must be a tsdown `entry`, so its name stays fixed.
- Tool versions live in the pnpm `catalog:` of `pnpm-workspace.yaml` only; create-droplets reads the same ranges.
- `minimumReleaseAge` is 7 days (`10080` minutes): pnpm resolves only versions published at least a week ago.
- Changesets: every public package is in one `fixed` group; pre mode is on with tag `alpha` (1.0.0-alpha.N). User-facing changes get a changeset (`pnpm changeset`). Never edit a `CHANGELOG.md` by hand.

## Docs

- Say exactly what and how: concrete steps, real code excerpts. A reader looks for their own stack.
- Every framework and every host gets its own page; don't frame one stack in terms of another.
- Tutorials are a story told in steps (WordPress: the shop, a plugin that brings in the droplets, then WordPress takes over data and login).
- Sidebar (`apps/docs/astro.config.mjs`): Start here, Writing droplets, Renderers (one page per framework, each with a live demo), Integrating (any stack, HTTP contract, Known hosts, WordPress), In the browser, Deployment, Security, Reference.
- Link between pages with root-relative paths (`/guides/configuration/`). A live droplet is a real one in `apps/demo/src/droplets/`.

## Gotchas

- Astro backgrounds `astro dev` when it detects a coding agent from the environment. Run `pnpm docs:dev` with the agent's variables unset
  (`env -u AI_AGENT -u <your tool's own> pnpm docs:dev`).
- The droplet location (public origin + prefix of `index.js`) is resolved once per request in `runtime/app.ts` (`resolveLocation`): `x-droplet-location`, then `Forwarded`, then `X-Forwarded-Proto` + `X-Forwarded-Host` (prefix from `X-Forwarded-Prefix`), then the single `origin` entry, then the request's origin. `X-Forwarded-*` is read as a fallback only and trusted only against the allow-list (`origin`/`DROPLETS_ORIGIN`, `trustedOrigins`/`DROPLETS_TRUSTED_ORIGINS`, the request's own origin): never widen that, since `Vary` doesn't protect a CDN. `"*"` is the owner's choice; it warns, never refuses. Request headers are `x-droplet-*`, response headers `x-droplets-*`.
- `vite build` resolves `vite.config` again per environment: each environment gets a fresh `droplets()` instance with its own random build hash. Never put per-instance random state into names decided in the `config` hook; use rolldown `[hash]` or shared hooks. Check output naming with a real `vite build` of a project with a config file, not only `configFile: false` tests.
- Preact's Prefresh is compiled in the renderer's own transform, never through Vite's shared `oxc` options.
- The Svelte renderer never turns on `experimental.async`; it detects it from vite-plugin-svelte's options.
- While editing a package, run `pnpm dev:lib` so `dist/` rebuilds; restart the example's Vite server after changing the plugin's `config` hook.
- CI must stay on GitHub-hosted runners with `pull_request` / `push` triggers only; never `pull_request_target`, `workflow_run` or a self-hosted runner.
