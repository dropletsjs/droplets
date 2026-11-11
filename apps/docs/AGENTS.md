`apps/docs`: the guide at https://dropletsjs.dev, Astro Starlight, with live droplets from `../demo`.

## Rules

- The docs state what the code does, per stack: concrete steps and real code excerpts.
- Every framework and every host has its own page, written for that stack on its own terms.
- Pages live in `src/content/docs/`, the only folder Starlight reads; `README.md`, `AGENTS.md` and `CLAUDE.md` stay outside it.
- Every page is in the `sidebar` of `astro.config.mjs`, in reading order: Start here, Writing droplets, Renderers (Overview, one page per renderer, each with a live `RendererDemo`), Integrating (any stack, HTTP contract, Known hosts, WordPress), In the browser, Deployment, Security, Reference.
- A live droplet is a real one in `../demo/src/droplets/`, embedded with `LiveDroplet` or `RendererDemo`; a page that embeds one fails the build unless the demo renders it.
  Checked by: `pnpm docs:build` (`src/components/live-droplet.ts`, `src/components/RendererDemo.astro`).
- Pages link to each other with root-relative paths (`/guides/configuration/`); `src/plugins/base-links.mjs` adds the base path.
- Every inline script hash is in `script-src` of `public/_headers`, and the demo origin appears only in `script-src`, `style-src`, `connect-src` and `form-action`.
  Checked by: `pnpm docs:check-csp`, after `pnpm docs:build`.
- Scripts of `src/components/*.astro` are bundled to files, never inlined, so the CSP hashes cover Starlight's scripts only.
  Checked by: `pnpm docs:check-csp`.
- The WordPress tutorial is a story in steps: the shop, a plugin that brings in the droplets, then WordPress takes over the data and the login.
- `pnpm docs:build` builds and starts `../demo` first (after `pnpm build` at the root) and fails without it.
  Checked by: `scripts/with-demo.mjs`, `src/components/live-droplet.ts`.
- The docs are built against the demo build that is live: the demo deploys first.
- The dev server runs with the agent variables unset, since Astro backgrounds `astro dev` when it detects a coding agent: `env -u CLAUDECODE -u AI_AGENT -u CLAUDE_CODE_ENTRYPOINT pnpm docs:dev`.
- A public API change comes with its matching change here.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).
