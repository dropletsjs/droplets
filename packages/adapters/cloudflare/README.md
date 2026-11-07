# @dropletsjs/adapter-cloudflare

The Cloudflare Workers adapter for [Droplets](../../droplets). `vite build`
emits `dist/worker.js`, a self-contained Worker with the SSR renderer and the
manifest inlined; the client build in `dist/client` is served through Workers
Static Assets.

```bash
pnpm add -D @dropletsjs/adapter-cloudflare@alpha wrangler
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { svelte } from "@dropletsjs/renderer-svelte";
import { cloudflare } from "@dropletsjs/adapter-cloudflare";

export default defineConfig({
  plugins: [droplets({ adapter: cloudflare(), renderers: [svelte()] })],
});
```

```jsonc
// wrangler.jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "my-droplets",
  "main": "dist/worker.js",
  "compatibility_date": "2025-10-01",
  // Server renderers (Svelte's among them) use AsyncLocalStorage from node:async_hooks.
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "dist/client",
    "binding": "ASSETS",
    // Our routes decide; the binding serves /assets/* and the bundles.
    "run_worker_first": true
  }
}
```

```bash
vite build
wrangler dev        # local, in workerd
wrangler deploy
```

Everything the Worker needs is in the bundle: no `node_modules` at runtime.
The `nodejs_compat` flag is required because server renderers (Svelte's among
them) use `AsyncLocalStorage`; Workers provide it under that flag. Environment
variables come from the Worker's bindings, and `platform.env` in server code
holds them all; prerendered droplets are read through the assets binding,
from `dist/client/_prerendered/<random>/`, a name new every build that only
the Worker's inlined manifest holds. `vite build` writes
`dist/client/.assetsignore` so `droplets.json` and `.vite/` are never
uploaded. `PORT` and
`server.port` from `droplets.config.ts` do not apply; the platform decides the
address. Set `cors` in the config if
pages on other origins embed your droplets.

`cloudflare({ assetsBinding })` changes the binding name from `ASSETS`.

`DROPLETS_SECRET` (signs the result of a form posted without JavaScript)
and `DROPLETS_TRUSTED_ORIGINS` (added to `trustedOrigins`) are read from
the Worker's bindings at runtime, as are your own variables; set the secret
with `wrangler secret put DROPLETS_SECRET`. See
[Deployment](https://dropletsjs.dev/guides/deployment/).
