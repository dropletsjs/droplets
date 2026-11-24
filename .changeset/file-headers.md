---
"@dropletsjs/droplets": patch
"@dropletsjs/adapter-node": patch
"@dropletsjs/adapter-cloudflare": patch
---

The headers of the build's files (`/index.js`, `/index.css`, `/assets/*`, `/assets/public/*`, `/droplets/<id>/client.js` and `style.css`) now come from one table, built from the config inside `@dropletsjs/droplets`. An adapter gets it as `fileHeaders` in `afterBuild` (each row a `FileHeaderRule`), and `createServerApp` sets it on every 2xx or 304 answer to a build file, on Node, Bun, Deno and the Cloudflare Worker alike; the Cloudflare adapter writes `dist/client/_headers` from it. A rule is `{ path, headers }`, where a `:name` segment matches one segment and a final `*` the rest; a path takes the last rule that matches.

Build files now carry `Access-Control-Allow-Origin: *` on Node, Bun and Deno too, as they already did on Cloudflare, whatever `cors` says, and `X-Content-Type-Options: nosniff` on `/index.js`, `/index.css`, `client.js` and `style.css` as well as `/assets/*`. Any page can import them as modules without `cors`. The `cors` middleware no longer answers for build files, a preflight included: a restricted `cors` (an origin list, `credentials`) now applies to fragments, `_data`, actions, `/env.js` and `/api/*` only, and a build file answers exactly `*`, without `Access-Control-Allow-Credentials` or `Vary: Origin`.
