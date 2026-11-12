---
"@dropletsjs/droplets": patch
---

A form action answers JSON only when the request's `accept` prefers it over HTML: `application/json` (or `application/*`) with a weight at least `text/html`'s, `q=0` excluded. `accept: application/json` (an enhanced form) still gets JSON; `text/html, application/json;q=0.1`, a browser's navigation and `*/*` alone get the native answer, where before any `accept` containing `application/json` did.
