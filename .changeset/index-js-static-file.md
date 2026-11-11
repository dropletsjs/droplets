---
"@dropletsjs/droplets": patch
---

`vite build` writes `/index.js` as a file, `dist/client/index.js`: static imports of `./env.js` (only when `src/env.ts` declares public variables read at runtime) and of the hashed entry, so the browser fetches them at once and runs `env.js` first, then the location record from its own URL. The production server serves that file as it is, `no-store`. `vite dev` serves `/index.js` as before.
