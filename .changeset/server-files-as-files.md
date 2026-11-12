---
"@dropletsjs/droplets": patch
---

A server file (`*.server.*`, `+server.*`, anything under a `server/` folder) reached from browser code as a file rather than a module, through `new URL(…, import.meta.url)`, a CSS `url()` or a `?url`, `?raw` or `?inline` import, fails `vite build` whether Vite would inline it as a `data:` URI or emit it as an asset, and `vite dev` answers 403 when the browser asks for one directly.
