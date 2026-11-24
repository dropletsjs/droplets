---
"@dropletsjs/droplets": patch
"@dropletsjs/adapter-node": patch
"@dropletsjs/adapter-cloudflare": patch
---

The headers of the build's files (`/index.js`, `/index.css`, `/assets/*`, `/assets/public/*`, `/droplets/<id>/client.js` and `style.css`) now come from one table, `fileHeaderTable(config)`, exported from `@dropletsjs/droplets` with `fileHeadersFor({ table, path })` and the `FileHeaderRule` type. An adapter gets it as `fileHeaders` in `afterBuild`, and `createServerApp` sets it on every 2xx or 304 answer to a build file: the Node, Bun and Deno static handler and the Cloudflare Worker apply it, and the Cloudflare adapter writes `dist/client/_headers` from it. A rule is `{ path, headers }`, where a `:name` segment matches one segment and a final `*` the rest; a path takes the last rule that matches. The headers themselves are unchanged.
