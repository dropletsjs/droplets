---
"@dropletsjs/droplets": patch
"create-droplets": patch
---

A script droplet (`+droplet.script.ts`) is always client only: `ssr` false, hydrated at once, never prerendered. A flag it exports warns once per file and is ignored. `djs add --framework script` writes no flag and takes no `--hydrate`.
