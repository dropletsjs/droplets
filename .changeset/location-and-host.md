---
"@dropletsjs/droplets": patch
---

`droplets.config.ts` takes `location` and `host`, one value each:

- `location`: where browsers reach the droplets server, an origin with an optional path prefix (`"https://shop.example/mfe"`), validated when the config is resolved; never `"*"`.
- `host`: the origin of the page the droplets render on (`"https://shop.example"`, no path), validated as a `trustedOrigins` entry; never `"*"`. Prerendering renders an entry without its own `host` there.

Without `location`, the droplet location is computed per request: `x-droplet-location`, then `Forwarded`, then `X-Forwarded-*`, each honoured only when its origin is the request's own or listed in `trustedOrigins` / `DROPLETS_TRUSTED_ORIGINS` (`"*"` trusts any); otherwise it is the request's own origin.

With `location`, `vite build` writes it into the server bundle (imported files, `new URL(…, import.meta.url)`, `$droplets/drop` outside a request, prerendered renders), and every request's location is `location`: no location header is read, and fragments vary on `origin` alone. Browser bundles are unchanged. `vite dev` ignores it.

With `host`, `event.host` is that origin, with the reported page's path and query when the page is on it, else the origin alone (`Origin` is not read); a form post from it passes the origin check and an action may redirect there. Prerendering renders an entry without its own `host` for it as a real URL (`hostname`, `protocol`, `port` readable, `search` and `hash` empty, the path filled in per request), stored under the origin alone, so it serves every page there. `vite dev` ignores it.
