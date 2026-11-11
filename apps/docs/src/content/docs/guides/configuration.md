---
title: Configuration
description: "Every option in droplets.config.ts, the plugin options and the environment variables."
---

## `droplets.config.ts`

Lives in the project root; `.mts`, `.js` and `.mjs` work too. It holds data
only; request handling lives in [`src/hooks.server.ts`](/guides/server/). The
plugin bundles it into the server build. The `config()` helper only adds
types.

```ts
import { config } from "@dropletsjs/droplets";

export default config({
  dropletsFolder: "src/droplets",   // the default
  apiFolder: "src/api",             // the default

  // The custom element hosting every droplet. Name it after the project so
  // several droplets servers can share a page. Default: "djs-droplet".
  element: "acme-widgets",

  // Pages on other origins embed these droplets: let their browsers in.
  cors: true,                       // or Hono cors() options: { origin: [...] }

  // Hosts whose pages post forms to these droplets: see "Form posts" below.
  trustedOrigins: ["https://shop.example"],
  csrf: { checkOrigin: true },      // the default
  limits: { multipart: 20 * 1024 * 1024 }, // bytes; the others keep their defaults

  // Fragments and _data: "private, no-store" by default; false sends none.
  fragmentCacheControl: "private, no-store",

  health: "/health",                // false: no health check
  index: "public/index.html",       // what / serves in production; false: 404
  importMap: "/importmap",          // false: never served

  dev: {
    server: { port: 5173 },         // Vite's own server.port wins if set
    strategy: "hmr",                // "remount" | "reload" | "manual"
    injectTool: false,              // the dev tool on every page
  },
  server: { port: 8000 },           // for node or bun dist/server.js
});
```

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `dropletsFolder` | `"src/droplets"` | Folder scanned for `<name>/+droplet.<ext>`. |
| `apiFolder` | `"src/api"` | Folder scanned for `**/+server.ts`, served under `/api/`. |
| `element` | `"djs-droplet"` | Tag name of the element that hosts every droplet. Lowercase with a hyphen. See [The element name](#the-element-name). |
| `cors` | off | `true` sends `Access-Control-Allow-Origin: *` on every route (`/api/*`, `_data`, `/index.js` included), and warns once in production; an object is passed to Hono's `cors()`. Needed whenever a page on another origin embeds your droplets. Prefer an origin list (`{ origin: ["https://shop.example"] }`) for anything not public: with `*`, any page can read what an employee's browser can reach on an intranet server. |
| `trustedOrigins` | `[]` | Origins, besides the server's own, allowed to send form submissions: the hosts whose pages post to your droplets. `"*"` trusts every origin. The `DROPLETS_TRUSTED_ORIGINS` environment variable (comma-separated, read at runtime on every adapter) adds to it. When set (without `"*"`), it also bounds `host`: a host on another origin becomes the server's own. An `x-host` is honoured only when its origin is the server's own or listed here (`"*"` does not count). The same list (without `"*"`) says where a form posted without JavaScript may be sent back to. See [Form posts](/integrate/http-contract/#form-posts-the-origin-check) and [Security model](/guides/security/). |
| `csrf.checkOrigin` | `true` | Answer `403` to a cross-site form submission (form-urlencoded, multipart or `text/plain` body, or none at all with an `Origin`) to `/droplets/*` or `/api/*` from an origin that is not trusted. `false` turns the check off. |
| `fragmentCacheControl` | `"private, no-store"` | The default `Cache-Control` of fragments and `_data`, when neither the droplet's load ([`setHeaders`](/guides/writing-droplets/#setheaders)) nor `handle` set one. `false` sends none. See [Caching](/guides/security/#caching). |
| `limits.json` | 1 MB | Largest JSON body, in bytes: render requests and `+server.ts`. Bigger answers `413`. |
| `limits.form` | 1 MB | Largest form-urlencoded or `text/plain` body. |
| `limits.multipart` | 10 MB | Largest multipart body, and body of any other type (uploads). A body without a `content-length` is held in memory while it is counted, up to the limit, so mind it times your concurrency. |
| `limits.props` | 8 KB | Largest `x-droplet-props` header; bigger answers `431`. `Infinity` lifts any limit. |
| `health` | `"/health"` | Path answering `ok`, before `handle` runs, so an auth hook cannot break it. `false` turns it off. |
| `index` | `index.html` in the root, else a placeholder | What `/` serves in `vite preview` and production: an HTML file, served as written. `false` answers `404`. In `vite dev`, `/` belongs to the [devtools](/guides/development/#the-devtools-page). |
| `importMap` | `"/importmap"`, when the client build has externals | Where the [import map](/guides/server/#import-maps) is served; `<path>.js` answers the inserting script. `false` turns both off. |
| `warnImportMap` | `true` | In dev, warn about externals the map misses, keys that are not external, and version drift. |
| `dev.server.port` | `5173` | Dev port, unless `vite.config.ts` sets `server.port`. |
| `dev.strategy` | `"hmr"` | What a droplet on a page does when its files change. `"hmr"` is the framework's own HMR, with new data for a load edit and a notice for a new render contract. `"remount"` loads the droplet again, `"reload"` reloads the page, and `"manual"` does nothing. See [Hot updates](/guides/development/#hot-updates). |
| `dev.injectTool` | `false` | Show the [dev tool](/guides/development/#the-dev-tool) on every page that loads `index.js`. |
| `server.port` | `8000` | Port for `node dist/server.js` and `bun dist/server.js`. `deno serve` takes `--port` instead. |

`health` and `importMap` must be paths the framework does not own: outside
`/`, `/index.js`, `/index.css`, `/droplets/`, `/assets/` and `/api/`.

### The element name

Every droplet renders inside a custom element, and `/index.js` defines it.
With the default name, two droplets servers on one page would both try to
define `<djs-droplet>`: the second one loses, and its droplets stay inert.
Give each server its own:

```ts
element: "acme-widgets",
```

The name must be a valid custom element name: lowercase, starting with a
letter, containing a hyphen. It appears in fragments
(`<acme-widgets data-droplet="hello" …>`), in `/index.js` and as the prefix of
every scoped style rule. Hosts that write the element themselves need to
know it.

## Plugin options

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { svelte } from "@dropletsjs/renderer-svelte";
import { dropletsDevtools } from "@dropletsjs/devtools";
import { node } from "@dropletsjs/adapter-node";

export default defineConfig({
  plugins: [
    droplets({
      configFile: "droplets.config.ts", // default: looked up in the Vite root
      adapter: node(),                  // required for vite build and preview
      renderers: [svelte()],            // the UI engines; see Renderers
      css: { tailwind: true },          // stylesheets; see below
    }),
    dropletsDevtools(),                 // vite dev only
  ],
});
```

- `adapter` decides what `vite build` emits as the server: `node()`, `bun()`
  and `deno()` give `dist/server.js`, `cloudflare()` a Worker. `vite dev` works without one. See
  [Adapters](/guides/deployment/#adapters).
- `renderers` lists the [renderers](/renderers/). Without one, every
  droplet folder is an error that names the package to install.
- `css` covers stylesheets: the one every droplet shares, scoping and
  Tailwind. See [`css`](#css).

### `css`

```ts
droplets({
  css: {
    path: "./src/app.css", // the shared stylesheet; false for none
    scoped: true,          // confine every stylesheet to the element
    tailwind: false,       // true: add @tailwindcss/vite
    twPreflight: true,     // false: leave Tailwind's reset out
  },
});
```

| Option | Default | Meaning |
| --- | --- | --- |
| `path` | `./src/app.css` if it exists | The stylesheet every droplet shares. It comes first in each droplet's `style.css`; `/index.css` serves it too. `false` for none. |
| `scoped` | `true` | Prefix every selector of every stylesheet with the element: the shared one, what droplets import, CSS modules, Svelte and Vue styles. See [Styles](/guides/writing-droplets/#styles). |
| `tailwind` | `false` | Add `@tailwindcss/vite`, unless the Vite config already has it. Install `tailwindcss` and `@tailwindcss/vite` yourself. |
| `twPreflight` | `true` | Keep Tailwind's preflight (its reset). `false` leaves it out, for host pages that bring their own. No effect without Tailwind. |

Tailwind is detected, not assumed: it is on when `@tailwindcss/vite` is in
the Vite config, whether you put it there or `tailwind: true` did. Without
Tailwind and without a `path`, droplets share no stylesheet.

#### Preflight in dev only

Tailwind's preflight resets margins, borders, fonts and form controls. When
the pages that embed your droplets load Tailwind themselves, they already
have it, and the droplets need not bring a second one. In dev there is no
such page, so keep it there and leave it out of the build:

```ts
export default defineConfig(({ command }) => ({
  plugins: [droplets({ css: { tailwind: true, twPreflight: command === "serve" } })],
}));
```

`twPreflight: false` turns `@import "tailwindcss"` into its theme and
utilities, and removes `@import "tailwindcss/preflight.css"`, in every
stylesheet Vite processes. An import Tailwind resolves inside one of them
(`app.css` importing a file that imports `tailwindcss`) is out of its reach;
the build warns when a preflight gets through that way.

The plugin sets `appType: "custom"`, adds what it needs to `server.fs.allow`,
and in build mode defines the `client`, `ssr` and `server` environments.
Anything else in `vite.config.ts` is yours; `build.outDir` is respected.
Client externals are declared in
`environments.client.build.rolldownOptions.external`; see
[Import maps](/guides/server/#import-maps).

## Environment variables

| Variable | Effect |
| --- | --- |
| `PORT` | Overrides both ports, so a container can relocate the server without a rebuild. |
| `DROPLETS_LOG` | Log verbosity: `error`, `warn`, `info` (default) or `debug`. |
| `DROPLETS_TRUSTED_ORIGINS` | Comma-separated origins added to `trustedOrigins`, read at runtime. |
| `DROPLETS_SECRET` | 32 or more random bytes, read at runtime: signs the result of a form posted without JavaScript, carried back to the page on the redirect ([Post/Redirect/Get](/guides/actions/#without-javascript-postredirectget)). Without it, or shorter, such a post answers the fragment instead, with a warning in the log. |

Your own variables are declared in `src/env.ts`; see
[Environment variables](/guides/server/#environment-variables).

## Config changes in dev

Editing `droplets.config.ts`, or any file it imports, restarts the dev server:
the config shapes routes, ports and the droplet registry, so a restart is the
only safe reaction.
