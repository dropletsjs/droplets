---
"@dropletsjs/droplets": patch
---

`+droplet.js` and `+droplet.server.js` are loaded like their `.ts` spellings: they were reserved names that discovery never looked for, so a droplet written in JavaScript had no load. One list, `.ts` then `.js`, now names what core loads by name (`+droplet`, `+droplet.server`, `+server`, `hooks.server`, `importmap.server`); `DropletEntry` carries `loadFile` and `serverLoadFile`. A file spelled `.mts`, `.mjs`, `.cts` or `.cjs` under one of those names is not loaded, and `vite dev` and `vite build` warn once naming the file and the name to use (`hooks.client` keeps its four extensions).
