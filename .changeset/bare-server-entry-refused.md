---
"@dropletsjs/droplets": patch
---

`@dropletsjs/droplets/server` imported by its bare name is refused where `$droplets/server` is: from a component or any project file that is not a server file, in `vite build` and under `vite dev`, naming the importer. A server file (`+droplet.server.ts`, `hooks.server.ts`, `+server.ts`, `*.server.*`, `server/`) may import it as before.
