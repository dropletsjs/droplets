`tests/dev-mixed`: every renderer in one project, under `vite dev` (render, hydrate, HMR without a reload) and in a production build (no dev code).

## Rules

- A production build holds no dev or HMR code: no `DEV_MARKERS` text, no `update` export, no dev module, for Node and for Cloudflare's `worker.js`.
  Checked by: `test/production.test.ts`.
- A build with `location` and `host` both fixed holds no host or location token and no `host-tokens` module in its server output or stored renders, for Node and Cloudflare; the builds that compute them per request still do.
  Checked by: `test/production.test.ts` ("a production build with location and host fixed").
- Dev code added to a package adds its marker to `DEV_MARKERS`, and a new dev module's file name to `DEV_MODULE`, in `test/production.test.ts`.
  Checked by: `test/production.test.ts`.
- Each renderer's transforms see that renderer's modules only: React's refresh in React's modules, Preact's Prefresh in Preact's.
  Checked by: `test/dev.test.ts`.
- An edit under `vite dev` never reloads the page: framework HMR, a remount, new data or a notice.
  Checked by: `test/dev.test.ts`.
- The tests import the packages' `dist/`: `pnpm build` first, then `pnpm test:integration`.
- A behaviour change comes with a test; a fix with a test that failed before it.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).
