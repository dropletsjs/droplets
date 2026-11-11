---
"@dropletsjs/droplets": patch
"@dropletsjs/adapter-node": patch
"@dropletsjs/adapter-cloudflare": patch
---

Every URL a droplet writes for its own files is on the droplet location, where `/index.js` is served from, path prefix included, for a host page on another origin and behind a proxy's prefix:

- Imported files, `new URL("./x.png", import.meta.url)` in components, CSS `url()` and chunk preloads: relative to the bundle or stylesheet in the browser, the request's location in server HTML, inline data, `_data` and action answers.
- `droplet.url()` from `$droplets/drop` passes an absolute URL through; outside a request on the server it gives `location` when the build sets it, else the build's location token; in the browser without a `/index.js` record it falls back to the root of the bundle's build, prefix included. `$droplets/form` and the element share that fallback.
- `public/` is copied to `dist/client/assets/public/` only and served at `/assets/public/*` with `cache-control: no-cache` and an `ETag` (304 when it matches), by the Node, Bun, Deno and Cloudflare adapters and `vite dev`.
- `vite dev` sets `server.origin` to the dev server, so file URLs load from a page on another origin.
- `hooks.server` `handle` never runs for `/index.js` and `/assets/*`.
- A host's `data-hydrate="false"` is ignored on a script droplet, with a warning in `vite dev`.
