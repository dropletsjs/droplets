# @dropletsjs/adapter-node

The Node adapter for [Droplets](../../droplets). `vite build` emits
`dist/server.js`, which bundles the framework's own dependencies and reads the
client build from `dist/client` at runtime.

```bash
pnpm add -D @dropletsjs/adapter-node@alpha
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { svelte } from "@dropletsjs/renderer-svelte";
import { node } from "@dropletsjs/adapter-node";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [svelte()] })],
});
```

```bash
vite build
PORT=8000 node dist/server.js
```

Importing `dist/server.js` instead of running it does not start listening; the
default export is `{ fetch }`, a standard `Request => Promise<Response>`
handler you can mount in Express or any other Node server. `vite preview`
serves the build through this adapter too.

`createNodeServerApp(paths, config)` is exported for hosts that want the Hono
app itself.

`DROPLETS_SECRET` (signs the result of a form posted without JavaScript)
and `DROPLETS_TRUSTED_ORIGINS` (added to `trustedOrigins`) are read from
the process environment at runtime, as are your own variables. See
[Deployment](https://dropletsjs.dev/guides/deployment/).
