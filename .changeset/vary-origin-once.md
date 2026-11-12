---
"@dropletsjs/droplets": patch
---

With `cors.origin` set to a list or a function, a fragment's and `_data`'s `vary` names `origin` once: the per-request headers are now added after `cors()` appended its own `Origin`, and the names are deduplicated whatever their case.
