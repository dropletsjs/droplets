---
"@dropletsjs/droplets": patch
"@dropletsjs/devtools": patch
"@dropletsjs/renderer-svelte": patch
"@dropletsjs/renderer-vue": patch
"@dropletsjs/renderer-handlebars": patch
---

The root of `@dropletsjs/droplets` exports `config`, `resolveConfig`, `isValidElementName`, the server and renderer helpers and the types; `logger` and `setLogLevel`, the `vite dev` and `vite build` log, are on `@dropletsjs/droplets/vite`, next to `droplets()` and the flag readers, for adapters and plugins at build time. `@dropletsjs/renderer-svelte`, `@dropletsjs/renderer-vue` and `@dropletsjs/renderer-handlebars` export their factory and their types; each reads a component's flags through the `readFlags` of the renderer object it returns. `@dropletsjs/devtools` exports `dropletsDevtools()` and the types `DevtoolsPageInput` and `ServerRender`.
