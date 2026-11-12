---
"@dropletsjs/droplets": patch
---

`x-droplets-build` is on every fragment and `_data` answer, `404` and `405` included, where before only a `_data` answer that reached the load carried it. The element reads it before the status, so a page now learns it is stale from a droplet a redeploy removed, and dispatches `droplets:stale`.
