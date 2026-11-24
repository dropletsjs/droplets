---
"@dropletsjs/droplets": patch
"@dropletsjs/devtools": patch
"@dropletsjs/adapter-node": patch
"@dropletsjs/adapter-cloudflare": patch
"@dropletsjs/renderer-svelte": patch
"@dropletsjs/renderer-vue": patch
"@dropletsjs/renderer-react": patch
"@dropletsjs/renderer-preact": patch
"@dropletsjs/renderer-solid": patch
"@dropletsjs/renderer-hono-jsx": patch
"@dropletsjs/renderer-handlebars": patch
"@dropletsjs/renderer-lit": patch
---

Every message Droplets writes, an error it throws or a warning it logs, in `vite build`, `vite dev`, the browser and the production server, now carries a stable code and a link to its page at `https://dropletsjs.dev/errors/<code>/`, which says what happened, when it happens and the fix. A thrown error has the code as `error.code`.

New `errorFormat` in `droplets.config.ts`: `"agent"` (the default) writes a block of labelled lines a coding agent can read,

```txt
droplets error load-result-not-object
  droplet: product-card
  file: src/droplets/product-card/+droplet.ts
  what: load must return a plain object
  fix: return an object literal from load, e.g. return { … }, or nothing
  docs: https://dropletsjs.dev/errors/load-result-not-object.md
```

a warning starting with `droplets warning`; `"human"` writes one line ending with the link. Any other value fails the build with `error-format-invalid`. The format applies everywhere, the production server and the browser included; there is no environment variable for it.

The text and shape of every message changed: a check that matches on a message's text should match on its code instead. A production server still logs errors only, with `console.error`: the coded message, then the error. What an endpoint answers (status and message) is unchanged.
