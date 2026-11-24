# @dropletsjs/adapter-node

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
- 5ab1b57: The headers of the build's files (`/index.js`, `/index.css`, `/assets/*`, `/assets/public/*`, `/droplets/<id>/client.js` and `style.css`) now come from one table, built from the config inside `@dropletsjs/droplets`. An adapter gets it as `fileHeaders` in `afterBuild` (each row a `FileHeaderRule`), and `createServerApp` sets it on every 2xx or 304 answer to a build file, on Node, Bun, Deno and the Cloudflare Worker alike; the Cloudflare adapter writes `dist/client/_headers` from it. A rule is `{ path, headers }`, where a `:name` segment matches one segment and a final `*` the rest; a path takes the last rule that matches.
  
  Build files now carry `Access-Control-Allow-Origin: *` on Node, Bun and Deno too, as they already did on Cloudflare, whatever `cors` says, and `X-Content-Type-Options: nosniff` on `/index.js`, `/index.css`, `client.js` and `style.css` as well as `/assets/*`. Any page can import them as modules without `cors`. The `cors` middleware no longer answers for build files, a preflight included: a restricted `cors` (an origin list, `credentials`) now applies to fragments, `_data`, actions, `/env.js` and `/api/*` only, and a build file answers exactly `*`, without `Access-Control-Allow-Credentials` or `Vary: Origin`.
- fe0b550: A prerender entry can now be written as a static file: `{ props: { page: 2 }, file: "page-2" }` in `entries` writes `dist/client/assets/prerendered/<id>/page-2.html`, served at `<location>/assets/prerendered/<id>/page-2`, holding exactly the fragment the server answers for those props. Files are written only when `droplets.config.ts` sets both `location` and `host`; without both, `file` is ignored and `vite build` warns once. `file` is a lowercase kebab-case name, unique per droplet; a bad or repeated one fails the build. A render that fails at build writes no file. The files are served like the build's other files, never through `handle`: `Cache-Control` is `fragmentCacheControl` with `no-transform`, as on the live fragment, with `Access-Control-Allow-Origin: *`, `nosniff`, an `ETag` and `304`; on Cloudflare a rule in the generated `dist/client/_headers` carries it, and Workers Static Assets serve the files without invoking the Worker (keep the default `assets.html_handling`; the adapter warns for `"none"` and `"force-trailing-slash"`). Node, Bun and Deno serve the extensionless URL from `<file>.html`, and `<file>.html` too. `transform` runs once at build for a file; the load's `setHeaders` headers are not sent with it. `vite dev` writes none: a request under `/assets/prerendered/` answers `404` and warns once per path, pointing at the live fragment.
  
  The messages `entries()` throws now name the droplet.
- Updated dependencies [1a37eb0]
- Updated dependencies [86cf275]
- Updated dependencies [68281df]
- Updated dependencies [5ab1b57]
- Updated dependencies [fe0b550]
- Updated dependencies [0933d3f]
  - @dropletsjs/droplets@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies
  - @dropletsjs/droplets@1.0.1

## 1.0.0

### Major Changes

- Initial release.
