---
"@dropletsjs/droplets": patch
---

`vite build` empties the output folder before the first environment builds, by Vite's `build.emptyOutDir` rule (always when `true`, never when `false`, else only inside the project; `.git` kept), so a build with `cloudflare()` no longer leaves `dist/server.js` of an earlier `node()` build next to `dist/worker.js`.
