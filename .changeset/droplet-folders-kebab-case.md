---
"@dropletsjs/droplets": patch
"create-droplets": patch
---

A droplet folder's name is its id and must already be lowercase kebab-case (`product-card`). Any other folder under `src/droplets/` (`ProductCard`, `hello_world`) is ignored, and `vite build` and `vite dev` warn once, listing those folders; two spellings of one name never collide. `djs add` accepts only lowercase kebab-case names.
