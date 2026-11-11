---
"@dropletsjs/droplets": patch
"@dropletsjs/devtools": patch
---

An empty stylesheet is not generated. A droplet with no CSS has no `style.css`: `/droplets/:id/style.css` answers 404, like `/index.css` without a shared stylesheet, in `vite dev` and behind every adapter. The build keeps no empty shared stylesheet and no empty `droplets-css.js`, and no fragment, element, `/index.js` record, prerendered render or dev page links to or preloads a stylesheet that does not exist.
