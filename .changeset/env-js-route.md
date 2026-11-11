---
"@dropletsjs/droplets": patch
"@dropletsjs/adapter-cloudflare": patch
---

`/env.js` serves the public variables read at runtime (`public: true` without `static` in `src/env.ts`), the script `/index.js` imports before the entry. It takes nothing from the request, never runs `handle`, follows `cors`, and answers 404 when no such variable is declared. It is sent `cache-control: public, max-age=600`; `DROPLETS_ENV_MAX_AGE` (seconds, read at runtime) changes that, `0` sends `no-store`, and an invalid value keeps 600 with a warning under `vite dev`. `/env.js` is a reserved path for `health` and `importMap`.
