---
"@dropletsjs/droplets": patch
---

`event.url` in `handle` and `+server.ts` carries the location's path prefix: under `https://shop.example/mfe`, a request for `/droplets/x?who=Ana` gives `https://shop.example/mfe/droplets/x?who=Ana`, where before the prefix was dropped. The URL a cookie's defaults are judged by is the same one.
