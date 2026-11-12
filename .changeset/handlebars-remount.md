---
"@dropletsjs/renderer-handlebars": patch
---

Under `vite dev` with `dev.strategy: "hmr"`, an edit to a Handlebars template that hydrates remounts the droplet in place, as Lit and Hono JSX do; a template that does not hydrate gets its fragment again. A compiled template holds no HMR code of its own.
