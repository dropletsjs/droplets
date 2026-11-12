`apps/docs`: the guide at https://dropletsjs.dev, Astro Starlight, with live droplets from `../demo`.

## Rules

- The docs state what the code does, per stack: concrete steps and real code excerpts.
- Every framework and every host has its own page, written for that stack on its own terms.
- Pages live in `src/content/docs/`, the only folder Starlight reads; `README.md`, `AGENTS.md` and `CLAUDE.md` stay outside it.
- Every page is in the `sidebar` of `astro.config.mjs`, in reading order: Start here, Writing droplets, Renderers (Overview, one page per renderer, each with a live `RendererDemo`), Integrating (any stack, client-only page, HTTP contract, Known hosts, WordPress), In the browser, Deployment, Security, Reference.
- A live droplet is a real one in `../demo/src/droplets/`, embedded with `LiveDroplet` or `RendererDemo`; a page that embeds one fails the build unless the demo renders it.
  Checked by: `pnpm docs:build` (`src/components/live-droplet.ts`, `src/components/RendererDemo.astro`).
- Pages link to each other with root-relative paths (`/guides/configuration/`); `src/plugins/base-links.mjs` adds the base path.
- Every inline script hash is in `script-src` of `public/_headers`, the demo origin appears only in `script-src`, `style-src`, `connect-src` and `form-action`, and Cloudflare Web Analytics' beacon (`https://static.cloudflareinsights.com/beacon.min.js/`) only in `script-src`.
  Checked by: `pnpm docs:check-csp`, after `pnpm docs:build`.
- Scripts of `src/components/*.astro` are bundled to files, never inlined, so the CSP hashes cover Starlight's scripts only.
  Checked by: `pnpm docs:check-csp`.
- A diagram shows one decision or one mechanism, ten nodes at most, top to bottom, next to the text it explains; a chart that would show more is split into several figures. Every node and arrow states what the code does, each arrow labelled with what moves (a route, a header, a fragment).
  Checked by: `pnpm docs:build` (`src/components/Diagram.astro` fails on a scene with more than ten nodes); the code: review.
- A diagram is a component of `src/components/` drawn with `diagram-kit.ts` and shown through `Diagram.astro`: a wide scene (620 px) and a narrow one (360 px), each shown at its own size or larger, type at 12.5 px or more, colors from the `--djs-*` tokens so it reads in the light and the dark theme, `role="img"` with a label and a description, and a caption that states the claim.
  Checked by: `pnpm docs:build` (`Diagram.astro` fails on any other scene width; the sizes live in `diagram-kit.ts` only); screenshots at 1280 and 390 px, light and dark, on review.
- Every diagram has the same full-screen viewer (wheel, pinch and drag; `+`, `-`, `0`, arrows, `Esc`; a close button) and SVG download, from `Diagram.astro` alone, in a bundled script; no figure has its own, and no external script or package draws them.
  Checked by: `pnpm docs:check-csp`; review.
- The pages are for people, `llms.txt`, `llms-full.txt`, `llms-small.txt` and the sets under `/_llms-txt/` for AI: `llms.txt` indexes every sidebar page with its absolute URL and description; the others carry the pages as text, with absolute links and no images, media, live droplets or button labels, and each diagram as its description. A page needs no change for them: what is a screen, not text, is left out by a selector in `astro.config.mjs`.
  Checked by: `pnpm docs:build` (`src/plugins/llms-txt.mjs`).
- The WordPress tutorial is a story in steps: the shop, a plugin that brings in the droplets, then WordPress takes over the data and the login.
- `pnpm docs:build` builds and starts `../demo` first (after `pnpm build` at the root) and fails without it.
  Checked by: `scripts/with-demo.mjs`, `src/components/live-droplet.ts`.
- The docs are built against the demo build that is live: the demo deploys first.
  Checked by: `needs: deploy-demo` on `deploy-docs` in `.github/workflows/ci.yml`, `../../tests/packages/test/workflows.test.ts` ("ci.yml's Cloudflare deploys").
- The dev server runs with the agent variables unset, since Astro backgrounds `astro dev` when it detects a coding agent: `env -u CLAUDECODE -u AI_AGENT -u CLAUDE_CODE_ENTRYPOINT pnpm docs:dev`.
- A public API change comes with its matching change here.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).
