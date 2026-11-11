---
"@dropletsjs/droplets": patch
"@dropletsjs/adapter-cloudflare": patch
---

The Cloudflare adapter leaves the build's files to Workers Static Assets, which answer them before the Worker runs:

- `vite build` writes `dist/client/_headers`: `Access-Control-Allow-Origin: *` and `Cache-Control: no-store` for `/index.js`; `public, max-age=2592000, immutable` for `/assets/*`, `/droplets/:id/client.js` and `/droplets/:id/style.css`; `publicCacheControl` for `/assets/public/*`. A `_headers` in the project root is appended after those rules.
- The build warns once when `assets.run_worker_first` in the wrangler config sends one of those files through the Worker (`true`, or a list that matches them), when `public/_headers` exists, and when `_headers` goes over 100 rules or 2,000 characters a line. It never fails.
- The Worker answers a missing file under `/assets/*` with `no-store`.
- `afterBuild` in the adapter contract receives the resolved `config`.
