---
"@dropletsjs/droplets": patch
---

`vite build` now fails when a prerender entry's `host` (from `entries()` in `+droplet.server.ts`) is outside the bound a request's host passes at runtime: with `host` in `droplets.config.ts`, an entry's `host` on another origin; without it, with `trustedOrigins` or `DROPLETS_TRUSTED_ORIGINS` (read from the build's environment) set, an origin that is not listed and is not the origin of `location`. Such a render was made and stored before, but the server never gives the droplet that host, so it was never served. The message names the droplet, the entry, its host and the bound, for example `droplets: testimonials: the entry {"page":2} names host https://abc.example/blog, outside trustedOrigins in droplets.config.ts (https://shop.example); add the origin there or drop the entry's host`. Entries without `host`, a list with `"*"` and a config with neither `host` nor a list are unchanged, and `vite dev` still renders entries live.
