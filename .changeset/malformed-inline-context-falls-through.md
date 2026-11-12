---
"@dropletsjs/droplets": patch
---

An inline context script the element cannot parse no longer leaves the droplet with empty props: it is logged, and `data-context`, then `data-params`, are read instead, as a `data-context` that does not parse already fell through to `data-params`.
