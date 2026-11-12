---
"@dropletsjs/droplets": patch
---

`fragmentCacheControl` (default `private, no-store`) is applied to `2xx` fragment and `_data` answers only: an error answer, a failed load, a `404`, a `405` and a redirect carry no default `Cache-Control`, so a value meant for content never keeps a failure. The `303` of a native form post that carries the signed result back to the page stays `private, no-store`. `Vary` is still on every answer.
