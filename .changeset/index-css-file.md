---
"@dropletsjs/droplets": patch
"@dropletsjs/adapter-node": patch
"@dropletsjs/adapter-cloudflare": patch
---

`vite build` writes `/index.css` as a file, `dist/client/index.css`: an `@import` of the hashed shared stylesheet under `/assets/`, so a page that links `/index.css` itself gets the new stylesheet after a deploy. Every adapter serves that file `no-store`, `handle` never runs for it, and the Cloudflare `_headers` gives it CORS and `no-store` with `/index.js`. Without a shared stylesheet there is no file and `/index.css` answers 404.
