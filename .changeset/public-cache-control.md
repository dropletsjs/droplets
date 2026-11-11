---
"@dropletsjs/droplets": patch
"@dropletsjs/adapter-node": patch
"@dropletsjs/adapter-bun": patch
"@dropletsjs/adapter-deno": patch
"@dropletsjs/adapter-cloudflare": patch
---

`publicCacheControl` in `droplets.config.ts` sets the `Cache-Control` of `public/` at `/assets/public/*` in a build: `"no-cache"` by default, a string to replace it, `false` for none, checked like `fragmentCacheControl`. The Node, Bun and Deno servers and the Cloudflare Worker send it, with the `ETag` and `304` as before. Hashed files, `/index.js` and `/env.js` keep their own.
