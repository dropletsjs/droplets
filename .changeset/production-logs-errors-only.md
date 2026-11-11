---
"@dropletsjs/droplets": patch
"@dropletsjs/adapter-node": patch
"@dropletsjs/adapter-bun": patch
"@dropletsjs/adapter-deno": patch
---

A production server logs errors only, with plain `console.error` (a message, then the error): a failed load, form action, request or `handleError`, an action redirect off-site, a missing `droplets.json`. Every warning (an untrusted forwarded location, `"*"` in `trustedOrigins`, a bad `DROPLETS_TRUSTED_ORIGINS` entry, `DROPLETS_SECRET` missing or short, `cors` allowing every origin, a malformed `x-droplet-props`, an action result over 2 KB) shows under `vite dev` and `vite build` only, and no production bundle holds the logger. The Node server prints nothing when it starts listening. `DEV_DROPLETS_LOG` sets the level of the dev and build log.
