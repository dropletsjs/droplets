---
"@dropletsjs/droplets": patch
"@dropletsjs/adapter-node": patch
"@dropletsjs/adapter-cloudflare": patch
---

A prerender entry can now be written as a static file: `{ props: { page: 2 }, file: "page-2" }` in `entries` writes `dist/client/assets/prerendered/<id>/page-2.html`, served at `<location>/assets/prerendered/<id>/page-2`, holding exactly the fragment the server answers for those props. Files are written only when `droplets.config.ts` sets both `location` and `host`; without both, `file` is ignored and `vite build` warns once. `file` is a lowercase kebab-case name, unique per droplet; a bad or repeated one fails the build. A render that fails at build writes no file. The files are served like the build's other files, never through `handle`: `Cache-Control` is `fragmentCacheControl` with `no-transform`, as on the live fragment, with `Access-Control-Allow-Origin: *`, `nosniff`, an `ETag` and `304`; on Cloudflare a rule in the generated `dist/client/_headers` carries it, and Workers Static Assets serve the files without invoking the Worker (keep the default `assets.html_handling`; the adapter warns for `"none"` and `"force-trailing-slash"`). Node, Bun and Deno serve the extensionless URL from `<file>.html`, and `<file>.html` too. `transform` runs once at build for a file; the load's `setHeaders` headers are not sent with it. `vite dev` writes none: a request under `/assets/prerendered/` answers `404` and warns once per path, pointing at the live fragment.

The messages `entries()` throws now name the droplet.
