---
"@dropletsjs/droplets": patch
"@dropletsjs/adapter-node": patch
"@dropletsjs/adapter-cloudflare": patch
"@dropletsjs/adapter-bun": patch
"@dropletsjs/adapter-deno": patch
---

A `droplets.config.ts` whose default export is a function now works in production: the server bundle calls it with the same `{ command, mode, isSsrBuild, isPreview }` the build passed it (a literal in the bundle), awaits what it returns and only then resolves the config, on every adapter. Functions inside the config, such as a `cors.origin` callback, are kept. Before, the production server read no key of the function and ran on the defaults.
