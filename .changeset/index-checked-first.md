---
"@dropletsjs/droplets": patch
---

`index` naming a file that does not exist fails `vite build` as the config resolves, before the client build, instead of after it.
