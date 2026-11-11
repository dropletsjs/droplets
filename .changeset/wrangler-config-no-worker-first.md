---
"create-droplets": patch
---

The generated `wrangler.jsonc` sets no `assets.run_worker_first`: Workers Static Assets answer the build's files with the headers of `dist/client/_headers`, and the rest reaches the Worker.
