# Contributing

Thanks for taking the time. This document covers how the repository is laid
out, how to run things locally and what a good pull request looks like. It is
the one contributing guide: the docs site's
[Contributing](https://dropletsjs.dev/reference/contributing/) page points here.

## Layout

```
packages/droplets/             @dropletsjs/droplets: the Vite plugin, the runtime, the djs CLI
packages/devtools/             @dropletsjs/devtools: the dev page and the dev tool
packages/adapters/node/        @dropletsjs/adapter-node: dist/server.js
packages/adapters/cloudflare/  @dropletsjs/adapter-cloudflare: dist/worker.js
packages/adapters/bun/         @dropletsjs/adapter-bun: dist/server.js for bun
packages/adapters/deno/        @dropletsjs/adapter-deno: dist/server.js for deno serve
packages/renderers/*/          @dropletsjs/renderer-{svelte,vue,react,preact,solid,hono-jsx,handlebars,lit}
packages/create-droplets/      create-droplets: npm create droplets
examples/frameworks/*/         one example per framework, the same three droplets each
examples/frameworks/Dockerfile the image of one of them (EXAMPLE=svelte for the hosts)
examples/shop/                 the shop demo, in six frameworks, on SQLite
examples/wp-shop/              the shop's droplets backed by WordPress
examples/hosts/*/              the eleven host examples, each named by its id (folder = docs page = test:hosts key)
tests/                         end-to-end tests across packages; a package's own tests are in its test/
tests/examples/                the framework examples in a browser (Playwright)
tests/hosts/                   the shop flow on every host's compose stack, recorded
tests/create-droplets/         npm create droplets end to end
tests/djs-add/                 djs add end to end
tests/dev-mixed/               React, Vue and Solid under vite dev, HMR in a browser
apps/docs/                     the guide (dropletsjs.dev), an Astro Starlight site
apps/demo/                     the live droplets the guide embeds (demo.dropletsjs.dev)
DESIGN.md                      design decisions, as they were taken
```

`packages/**`, `examples/*`, `examples/frameworks/*`, `tests/*` and `apps/*`
form a pnpm workspace; `pnpm build` compiles every package in dependency
order. `examples/hosts/*` are deliberately **not** in the workspace: each has
its own toolchain (npm, Python, Ruby, PHP…) and runs with Docker Compose or
on its own. The tool ranges the examples and tests use (Vite, TypeScript,
Tailwind, Playwright…) are the pnpm `catalog:` in `pnpm-workspace.yaml`;
create-droplets writes the same ranges into new projects.
Bumping a tool's version means editing that catalog in `pnpm-workspace.yaml`
only: every `package.json` that uses it says `"catalog:"`, so none of them
changes (run `pnpm install` to update the lockfile), and create-droplets
reads the new range when it is next built.

`apps/demo` is not under `examples/`: it is deployed with the docs
(demo.dropletsjs.dev) and its config trusts only the docs' origins
(`src/lib/origins.ts`), so it is part of the docs site, not a project to copy.

## Prerequisites

- Node 22 or newer (CI runs 22 and 24)
- pnpm 10 (`corepack enable` or `npm i -g pnpm`)
- Bun and Deno, optional: their adapters' suites are skipped without them
- Docker, only for `examples/hosts/*` and `pnpm test:hosts`

## Setup

```bash
pnpm install
pnpm build          # compiles every package into its dist/ (the examples import dist)
pnpm dev            # http://localhost:5173: the Svelte example with hot updates
pnpm dev:shop       # the shop instead
pnpm docs:dev       # the guide on http://localhost:4321, with apps/demo beside it
```

While working on the framework itself, run `pnpm dev:lib` in a second
terminal so `dist/` is rebuilt on save; the example's Vite server picks up
the change on the next request (restart it if you change the plugin's
`config` hook).

## Checks

```bash
pnpm typecheck                  # tsc over every package, example and test
pnpm test                       # vitest: unit tests plus real `vite build` / `vite dev` on fixtures
pnpm build:examples             # the eight framework examples for Node
pnpm build:examples:cloudflare  # and for Cloudflare Workers
pnpm check                      # all of the above, the shops' build and tests, apps/demo's build and tests
pnpm test:e2e                   # tests/examples: the framework examples in Chromium
pnpm test:hosts [host…]         # tests/hosts: the shop on each host stack (Docker)
```

Tests live in each package's `test/`. Top-level `tests/<what>/` is for
end-to-end tests that cross packages: they build or start real projects
(the framework examples, the host stacks, `npm create droplets`, `djs add`,
a mixed `vite dev`) and check them from outside, in a browser or a shell. A
test of one package's behaviour goes in that package's `test/`, even when
it builds a fixture. Unit tests import from `src/`
directly; the integration tests need `dist/` to exist, so run `pnpm build`
first (`pnpm check` does). Every renderer runs `rendererConformance()` from
`@dropletsjs/droplets/testing` on a fixture app in its `test/fixtures/app`: a
change to the renderer contract shows up there for all of them.

## Making changes

- Keep the framework free of application concerns. Anything that only one
  host needs belongs in that host.
- A behaviour change needs a test. A fix needs a test that failed before it.
- Nothing from a `*.server.*` file or a `server/` folder may reach a client
  bundle; the build and `vite dev` both refuse it, and so should your change.
- Treat what a request carries as plain data: no prototype keys, checked with
  `Object.hasOwn`, the code resolved before any body is parsed.
- Public API changes (config options, routes, the element contract, the
  renderer contract) need a matching change in `apps/docs/`.
- Run `pnpm check` before opening the pull request.

## Versioning and changelog

Releases are managed with [Changesets](https://github.com/changesets/changesets).
The 13 public packages are one `fixed` group, so they always share a version,
and pre mode is on with the `alpha` tag (1.0.0-alpha.N). Any change that
affects users of a published package comes with a changeset:

```bash
pnpm changeset
```

Pick the bump (`patch` for fixes, `minor` for features, `major` for breaking
changes) and describe the change from a user's point of view. The changelogs
are generated from these files at release time (`pnpm version-packages`); do
not edit a `CHANGELOG.md` by hand. See [`.changeset/README.md`](./.changeset/README.md).

## Docs

The guide lives in `apps/docs/src/content/docs/` as Markdown/MDX; the sidebar, in
reading order, is listed in `apps/docs/astro.config.mjs`. `pnpm docs:dev` previews
it. Link between pages with root-relative paths (`/guides/configuration/`);
the build prefixes them when the site is served from a sub-path. A change to
a config option, a route or the `<djs-droplet>` contract needs a matching docs
change. See `apps/docs/README.md` for how to show live droplets in pages and how to
deploy. A live droplet is a real one from `apps/demo`: `pnpm docs:build`
builds and starts the demo server and inlines its fragments, and
`pnpm docs:dev` runs the demo's dev server next to Astro. A droplet the
docs need goes in `apps/demo/src/droplets/`, with its tests in
`apps/demo/test/`.

## Examples

- `examples/frameworks/*` share their shape: the same three droplets, the
  same `lib/` modules, the same endpoints. A change to one usually belongs in
  all eight; `tests/examples` runs the same checks on each.
- Each folder under `examples/hosts/` must keep working against the image
  built from `examples/frameworks/Dockerfile` and the shop's:

  ```bash
  cd examples/hosts/<name>
  docker compose up --build
  ```

  If you add one, follow the pattern of the existing ones (fetch the fragment
  server-side with `x-host`, load `/index.js` once), add a README and a
  `docker-compose.yml`, a row to `examples/hosts/README.md`, and an entry to
  `tests/hosts/run.mjs`.

## Reporting issues

Please include the versions of Node, Vite and `@dropletsjs/droplets`, the
relevant part of `droplets.config.ts` and, for rendering issues, the droplet's
component with its `ssr`/`hydrate` flags. Report security issues privately,
as the README's Security section says.
