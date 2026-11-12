---
"@dropletsjs/droplets": patch
---

`import url from "./x.css?url"` in `+droplet.ts` or `+droplet.server.ts` builds: a build turns the import into a `?transform-only` module, which the load-CSS check took for a stylesheet and refused with a chain that named the plain file.
