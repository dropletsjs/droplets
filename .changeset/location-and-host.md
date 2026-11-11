---
"@dropletsjs/droplets": patch
---

`droplets.config.ts` takes `location` and `host`, one value each:

- `location`: where browsers reach the droplets server, an origin with an optional path prefix (`"https://shop.example/mfe"`), validated when the config is resolved; never `"*"`.
- `host`: the origin of the page the droplets render on (`"https://shop.example"`, no path), validated as a `trustedOrigins` entry; never `"*"`. Prerendering renders an entry without its own `host` there.

Without `location`, the droplet location is computed per request: `x-droplet-location`, then `Forwarded`, then `X-Forwarded-*`, each honoured only when its origin is the request's own or listed in `trustedOrigins` / `DROPLETS_TRUSTED_ORIGINS` (`"*"` trusts any); otherwise it is the request's own origin.
