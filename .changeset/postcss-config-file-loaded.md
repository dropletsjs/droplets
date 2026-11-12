---
"@dropletsjs/droplets": patch
---

`css.scoped` keeps the project's PostCSS config file: setting `css.postcss` inline made Vite skip `postcss.config.js`, so its plugins silently stopped running. The plugin now loads the file as Vite does (`postcss-load-config`, from `css.postcss` when that names a directory, else from the root), puts its plugins before the scoping one and keeps its options; a file that fails to load fails `vite dev` and `vite build`, naming the file. An inline `css.postcss` still wins, as for Vite.
