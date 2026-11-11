`apps/demo`: the droplets the docs embed live, one server with every renderer, at https://demo.dropletsjs.dev.

## Rules

- The demo trusts only the docs' origins: `cors.origin` and `trustedOrigins` in `droplets.config.ts` both come from `docsOrigins()` in `src/lib/origins.ts`, exact origins only.
  Checked by: `test/origins.test.ts`, `test/server.test.ts` ("CORS", "who may post"), `test/worker.test.ts` ("refuses CORS and form posts to other origins").
- The Worker serves static files with `assets.run_worker_first: true` in `wrangler.jsonc`, so `/index.js`, `/droplets/*` and `/assets/*` get the Worker's CORS and cache headers.
  Checked by: `test/worker.test.ts`.
- Every live droplet the guide embeds is a real droplet in `src/droplets/`; a docs page embeds only droplets that exist here.
  Checked by: `pnpm docs:build` (`../docs/src/components/live-droplet.ts`, `../docs/src/components/RendererDemo.astro`).
- Each renderer has one `counter-<renderer>` droplet, the same card in each, whose files are what its renderer page shows.
  Checked by: `test/server.test.ts` ("the renderer pages' counters").
- Each droplet uses one framework; code shared between droplets lives in `src/lib/` and is framework-agnostic.
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
