---
"@dropletsjs/droplets": patch
---

A `+server.ts` `fallback` handles every method the module does not export, a non-standard one (`FOO`) included, as in SvelteKit; before, such a method answered `405`. A `405` lists the exported methods in `allow`, and omits the header when there is none, instead of sending it empty.
