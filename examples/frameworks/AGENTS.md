`examples/frameworks`: one standalone droplets project per renderer, each serving the same three droplets.

## Rules

- Each example is standalone: users copy it, so it reads well on its own and needs nothing from the rest of the repository but published packages. Only `Dockerfile` builds from the repository root, against the workspace packages.
- An example depends only on published `@dropletsjs/*` packages and public tools, declared with the published ranges (`^<version>`, the catalog's literal tool ranges; never `workspace:`, `catalog:`, `@dropletsjs/shared` or a `../../` path); pnpm links them to the workspace packages here.
  Checked by: `../../tests/packages/test/examples.test.ts`, `../../tests/hosts/test/standalone.test.ts`.
- Every example serves the same three droplets, `client`, `ssr-hydrate` and `ssr-nohydrate`, with the same loads, props, endpoints, env and hooks; a change to one belongs in all eight.
  Checked by: `../../tests/examples/e2e/examples.spec.ts` (`pnpm test:e2e`).
- Additions beyond the three stay framework-specific: Svelte's `page-views`, Lit's `guestbook`.
  Checked by: `../../tests/examples/e2e/lit.spec.ts` for Lit.
- A droplet uses one framework: each example lists one renderer.
  Checked by: the plugin, in `vite build` and `vite dev`.
- `*.server.*` and `src/lib/server/` never reach a client bundle.
  Checked by: the plugin, in `vite build` and `vite dev`.
- Every example builds for Node and for Cloudflare.
  Checked by: `pnpm build:examples`, `pnpm build:examples:cloudflare` (both in `pnpm check`).
- Every example typechecks on its own (`djs sync`, then its framework's checker).
  Checked by: `pnpm typecheck`.
- An endpoint here takes plain data: `JSON.parse` or `FormData`, own-field lookups, a size limit.
- The Svelte example is the droplets server the host examples run: `Dockerfile` builds it by default.
  Checked by: CI's Docker smoke test, `pnpm test:hosts`.
- Comments explain a non-obvious why.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).
