---
"@dropletsjs/droplets": patch
---

The element reads `x-droplets-build` before an answer's status or body, for a fragment it asks for again after a form action as it already did for `_data`: a `404` from a newer build that no longer has the droplet dispatches `droplets:stale` instead of logging a missing fragment, and the markup on the page stays as it is.
