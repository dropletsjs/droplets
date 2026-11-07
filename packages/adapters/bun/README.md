# @dropletsjs/adapter-bun

The Bun adapter for [Droplets](../../droplets). `vite build` emits
`dist/server.js`, which bundles the framework's own dependencies and reads the
client build from `dist/client` at runtime.

```bash
bun add -d @dropletsjs/adapter-bun@alpha
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { svelte } from "@dropletsjs/renderer-svelte";
import { bun } from "@dropletsjs/adapter-bun";

export default defineConfig({
  plugins: [droplets({ adapter: bun(), renderers: [svelte()] })],
});
```

```bash
bun run build
PORT=8000 bun dist/server.js
```

The default export is `{ port, fetch }`: Bun serves it when `dist/server.js`
is the entry point, on `server.port` from `droplets.config.ts` (`PORT`
overrides it). Imported from your own server, it only hands over `fetch`, a
standard `Request => Promise<Response>` handler. `vite preview` serves the
build through this adapter too.

The app is the [Node adapter](../node)'s, running on Bun's `node:` modules.

`DROPLETS_SECRET` (signs the result of a form posted without JavaScript)
and `DROPLETS_TRUSTED_ORIGINS` (added to `trustedOrigins`) are read from
the process environment at runtime, as are your own variables. See
[Deployment](https://dropletsjs.dev/guides/deployment/).
