# @dropletsjs/droplets

## 1.0.2

### Patch Changes

- 1a37eb0: Every message Droplets writes, an error it throws or a warning it logs, in `vite build`, `vite dev`, the browser and the production server, now carries a stable code and a link to its page at `https://dropletsjs.dev/errors/<code>/`, which says what happened, when it happens and the fix. A thrown error has the code as `error.code`.
  
  New `errorFormat` in `droplets.config.ts`: `"agent"` (the default) writes a block of labelled lines a coding agent can read,
  
  ```txt
  droplets error load-result-not-object
    droplet: product-card
    file: +droplet.ts
    what: load must return a plain object
    fix: return an object literal from load, e.g. return { … }, or nothing
    docs: https://dropletsjs.dev/errors/load-result-not-object.md
  ```
  
  a warning starting with `droplets warning`; `"human"` writes one line ending with the link. Any other value fails the build with `error-format-invalid`. The format applies everywhere, the production server and the browser included; there is no environment variable for it.
  
  The text and shape of every message changed: a check that matches on a message's text should match on its code instead. A production server still logs errors only, with `console.error`: the coded message, then the error. What an endpoint answers (status and message) is unchanged.
- 86cf275: With `credentials: true` in `cors` and an `origin` other than `"*"`, the browser runtime's own requests (an enhanced form's post, `_data`, a fragment rendered again after a post) now send `credentials: "include"`, so a page on another origin gets the droplets server's cookies back and forth, as a cart or a login needs. Without `credentials`, with `cors: true`, or with an `origin` of `"*"`, they keep the browser's default, `same-origin`. The client build learns only that one boolean from `cors`; the origin list or function stays on the server. Browsers still treat the cookies as third-party when the page and the droplets server are on different sites: see Cookies across origins in the security guide.
- 68281df: `vite build` now fails when a prerender entry's `host` (from `entries()` in `+droplet.server.ts`) is outside the bound a request's host passes at runtime: with `host` in `droplets.config.ts`, an entry's `host` on another origin; without it, with `trustedOrigins` or `DROPLETS_TRUSTED_ORIGINS` (read from the build's environment) set, an origin that is not listed and is not the origin of `location`. Such a render was made and stored before, but the server never gives the droplet that host, so it was never served. The message, `prerender-host-outside-host` or `prerender-host-untrusted`, names the droplet, the entry, its host and the bound, for example `the entry {"page":2} names host https://abc.example/blog, outside trustedOrigins in droplets.config.ts (https://shop.example)` for the droplet `testimonials`. Entries without `host`, a list with `"*"` and a config with neither `host` nor a list are unchanged, and `vite dev` still renders entries live.
- 5ab1b57: The headers of the build's files (`/index.js`, `/index.css`, `/assets/*`, `/assets/public/*`, `/droplets/<id>/client.js` and `style.css`) now come from one table, built from the config inside `@dropletsjs/droplets`. An adapter gets it as `fileHeaders` in `afterBuild` (each row a `FileHeaderRule`), and `createServerApp` sets it on every 2xx or 304 answer to a build file, on Node, Bun, Deno and the Cloudflare Worker alike; the Cloudflare adapter writes `dist/client/_headers` from it. A rule is `{ path, headers }`, where a `:name` segment matches one segment and a final `*` the rest; a path takes the last rule that matches.
  
  Build files now carry `Access-Control-Allow-Origin: *` on Node, Bun and Deno too, as they already did on Cloudflare, whatever `cors` says, and `X-Content-Type-Options: nosniff` on `/index.js`, `/index.css`, `client.js` and `style.css` as well as `/assets/*`. Any page can import them as modules without `cors`. The `cors` middleware no longer answers for build files, a preflight included: a restricted `cors` (an origin list, `credentials`) now applies to fragments, `_data`, actions, `/env.js` and `/api/*` only, and a build file answers exactly `*`, without `Access-Control-Allow-Credentials` or `Vary: Origin`.
- fe0b550: A prerender entry can now be written as a static file: `{ props: { page: 2 }, file: "page-2" }` in `entries` writes `dist/client/assets/prerendered/<id>/page-2.html`, served at `<location>/assets/prerendered/<id>/page-2`, holding exactly the fragment the server answers for those props. Files are written only when `droplets.config.ts` sets both `location` and `host`; without both, `file` is ignored and `vite build` warns once. `file` is a lowercase kebab-case name, unique per droplet; a bad or repeated one fails the build. A render that fails at build writes no file. The files are served like the build's other files, never through `handle`: `Cache-Control` is `fragmentCacheControl` with `no-transform`, as on the live fragment, with `Access-Control-Allow-Origin: *`, `nosniff`, an `ETag` and `304`; on Cloudflare a rule in the generated `dist/client/_headers` carries it, and Workers Static Assets serve the files without invoking the Worker (keep the default `assets.html_handling`; the adapter warns for `"none"` and `"force-trailing-slash"`). Node, Bun and Deno serve the extensionless URL from `<file>.html`, and `<file>.html` too. `transform` runs once at build for a file; the load's `setHeaders` headers are not sent with it. `vite dev` writes none: a request under `/assets/prerendered/` answers `404` and warns once per path, pointing at the live fragment.
  
  The messages `entries()` throws now name the droplet.
- 0933d3f: A droplet's loads and render on the server now have a deadline: `render: { timeout }` in `droplets.config.ts`, in milliseconds, `5000` by default. A fragment or `_data` request whose loads and component render have not finished by then answers `504`: the fragment with the droplet's `+error.*` page, `_data` with `{ error }`, where `error` is `{ status: 504, message: "Gateway Timeout" }`; the browser renders the error page for both. Loads that take longer than 5 seconds, which answered before, now answer `504` unless you raise `render.timeout`; `Infinity` keeps the previous behaviour. The server load sees the deadline in `event.request.signal` (a copy of the request with that signal; on Node, Bun and Deno it still aborts when the client goes away too): pass it to `fetch` and your database client so their work stops. Renders prerendered by `vite build` have no deadline. A production server logs nothing for a timeout; `vite dev` warns. A host that pastes fragments should accept a `504` `text/html` answer like a `500` one, and wait longer than `render.timeout`.

## 1.0.1

### Patch Changes

- Fragments and `_data` answers now carry `Cache-Control: no-transform`, so proxies that rewrite HTML (Cloudflare Web Analytics' automatic setup, Email Address Obfuscation, mod_pagespeed and the like) no longer append scripts after the droplet element. The default `fragmentCacheControl` is `private, no-store, no-transform`, and `no-transform` is added, once, to any other value: your config's, a load's `setHeaders`, `handle`'s and an error answer's. Redirects, a form action's JSON, `+server.ts` routes and static files are unchanged.
  
  Since a proxy that honors `no-transform` stops compressing those answers, the server now gzips them itself when the request's `Accept-Encoding` takes gzip and the body is 1024 bytes or more, with `Vary: Accept-Encoding` on every fragment and `_data` answer; a streamed fragment stays streamed. A host that pastes fragments into its pages server-side should request them without `Accept-Encoding` or with a client that decodes gzip (nginx SSI: clear `Accept-Encoding` on the proxied location).
  
  The commands to copy in the docs and READMEs now read `npm create droplets@latest`, so npx never runs a cached older `create-droplets`.

## 1.0.0

### Major Changes

- Initial release.
