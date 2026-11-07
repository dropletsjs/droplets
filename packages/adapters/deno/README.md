# @dropletsjs/adapter-deno

The Deno adapter for [Droplets](../../droplets). `vite build` emits
`dist/server.js`, which bundles the framework's own dependencies and reads the
client build from `dist/client` at runtime.

```bash
deno add -D npm:@dropletsjs/adapter-deno
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { svelte } from "@dropletsjs/renderer-svelte";
import { deno } from "@dropletsjs/adapter-deno";

export default defineConfig({
  plugins: [droplets({ adapter: deno(), renderers: [svelte()] })],
});
```

```bash
deno task build
deno serve -A --port 8000 dist/server.js
```

The default export is `{ fetch }`, which `deno serve` serves; `--parallel`
runs one worker per CPU core. `deno serve` owns the port (8000 unless
`--port` says otherwise), so `server.port` in `droplets.config.ts` and `PORT`
do not apply. Imported from your own server, `fetch` is a standard
`Request => Promise<Response>` handler. `vite preview` serves the build
through this adapter too.

The app is the [Node adapter](../node)'s, running on Deno's `node:` modules.
`-A` grants what it needs: reading the build directory, the environment for
`$droplets/env/private`, and the network.

`DROPLETS_SECRET` (signs the result of a form posted without JavaScript)
and `DROPLETS_TRUSTED_ORIGINS` (added to `trustedOrigins`) are read from
the process environment at runtime, as are your own variables. See
[Deployment](https://dropletsjs.dev/guides/deployment/).
