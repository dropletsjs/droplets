---
"@dropletsjs/droplets": patch
---

`+droplet.server.d.ts` is a load file's declaration, never a second component: `.server.d.ts` joins the core suffixes. A `+droplet.handlebars` file no longer asks to install the Handlebars renderer, which handles `+droplet.hbs` alone: the error says to rename the file.
