---
"@dropletsjs/droplets": patch
---

One shape for `404` and `405` on the fragment and `_data`: an unknown droplet answers `404` before any method check, whatever the method (`Not Found` as text, `{ "message": "Not Found" }` on `_data`); a known droplet answers `405` with `allow: GET, POST` to `PUT`, `PATCH`, `DELETE` and any other method on both routes, where the fragment answered `404` before. A path no route matches answers through one `notFound`, text or `{ "message": "Not Found" }` under `_data` and `/api`. A trailing-slash path (`/droplets/x/`) is such a path: its body is never read.
