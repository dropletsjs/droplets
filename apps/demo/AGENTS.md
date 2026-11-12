`apps/demo`: the droplets the docs embed live, one server with every renderer, at https://demo.dropletsjs.dev.

## Rules

- The demo trusts only the docs' origins: `cors.origin` and `trustedOrigins` in `droplets.config.ts` both come from `docsOrigins()` in `src/lib/origins.ts`, exact origins only.
  Checked by: `test/origins.test.ts`, `test/server.test.ts` ("CORS", "who may post"), `test/worker.test.ts` ("refuses CORS and form posts to other origins"); the build's files are public, sent to any origin.
- `wrangler.jsonc` sets no `run_worker_first`: static assets answer `/index.js`, `/index.css`, `/assets/*` and each droplet's `client.js` and `style.css` with the headers of `dist/client/_headers`; renders, `_data`, actions and `/env.js` reach the Worker.
  Checked by: `test/worker.test.ts` ("static assets, with the headers of _headers").
- Search engines may fetch every answer but index none: the Worker's answers carry `X-Robots-Tag: noindex` from `handle` (`src/hooks.server.ts`), the static assets from the root `_headers`; no `robots.txt` disallows them.
  Checked by: `test/server.test.ts` ("search engines"), `test/worker.test.ts` ("tells search engines not to index the build's files, and keeps no robots.txt from fetching them").
- `location` and `host` are fixed in `droplets.config.ts` (`https://demo.dropletsjs.dev`, `https://dropletsjs.dev`): the build holds no token and reads no location header; nothing passes a location to the demo.
  Checked by: `test/server.test.ts` ("the droplet location").
- The prerendered testimonials pages are exported by the demo's own build step (`scripts/export-testimonials.mjs`, in `build` and `build:cloudflare`) as `dist/client/assets/public/testimonials/page-<n>.html`, each byte-equal to its route's answer; `html_handling: "none"` serves them under that name.
  Checked by: `test/server.test.ts` ("exports each prerendered page"), `test/worker.test.ts` ("answers the exported testimonials pages").
- `/api/testimonials` reads its query key by key from `URLSearchParams` against a fixed list, checks every integer's range, merges nothing and answers any other query 400 with a message.
  Checked by: `test/server.test.ts` ("GET /api/testimonials").
- Every live droplet the guide embeds is a real droplet in `src/droplets/`; a docs page embeds only droplets that exist here.
  Checked by: `pnpm docs:build` (`../docs/src/components/live-droplet.ts`, `../docs/src/components/RendererDemo.astro`).
- Each renderer has one `counter-<renderer>` droplet, the same card in each, whose files are what its renderer page shows.
  Checked by: `test/server.test.ts` ("the renderer pages' counters").
- Each droplet uses one framework; code shared between droplets lives in `src/lib/` and is framework-agnostic, but for `src/lib/Testimonials.svelte`, shared by the Svelte testimonials droplets only.
- The poll's action takes plain `FormData`, reads one field by name as a bounded string, looks it up in a `Map`, merges nothing and answers a code, never the submitted value.
  Checked by: `test/server.test.ts` ("plain data only").
- The droplet and the action are resolved before any body is read, and every body has a size limit (`limits` in `droplets.config.ts`).
  Checked by: `test/server.test.ts` ("the code is resolved before the body is read", "size limits").
- The poll is stateless: nothing is stored, counted or shared between visitors.
  Checked by: `test/server.test.ts` ("is stateless").
- Server-only code stays out of client bundles and out of the Worker's uploaded assets.
  Checked by: `test/server.test.ts` ("server-only code"), `test/worker.test.ts` ("serves nothing server-only", "uploads no server code").
- `DROPLETS_SECRET` lives in the gitignored `.env.local` or a Worker secret, never in a committed file.
- The demo deploys before the docs, and the docs are then built against it.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).
