---
title: Contributing
description: "Where the contributing guide lives, what a clone needs, and the commands that build, check and test the repository."
---

The contributing guide is
[`CONTRIBUTING.md`](https://github.com/dropletsjs/droplets/blob/main/CONTRIBUTING.md)
at the root of the repository: the layout, the checks, what a pull request
needs, how releases are versioned and how this site is built. It is the one
copy; this page lists what you need to start.

## What a clone needs

- Node 22 or newer, and pnpm 10.
- Bun and Deno only for their adapters' suites, which are skipped without
  them.
- Docker only for `examples/hosts/*` and `pnpm test:hosts`.

## Commands

```bash
pnpm install
pnpm build            # every package with tsdown, and its unit tests: a failing suite stops the build
pnpm dev              # the Svelte example (examples/frameworks/svelte) on http://localhost:5173
pnpm docs:dev         # this site on http://localhost:4321, with apps/demo beside it
```

```bash
pnpm check            # biome ci, build, typecheck, tests/*, the framework examples (Node and Cloudflare),
                      # the shop and wp-shop builds and tests, apps/demo
pnpm test:e2e         # builds examples/frameworks/*, runs tests/examples in Chromium
pnpm docs:build       # builds and starts apps/demo, then builds this site (run pnpm build first)
pnpm docs:check-csp   # after docs:build: every inline script hash is in apps/docs/public/_headers
pnpm typecheck:hosts  # npm ci and npm run typecheck in each Node host of examples/hosts
```

A user-facing change carries a changeset (`pnpm changeset`); the public
packages version together. `CONTRIBUTING.md` has the rest.
