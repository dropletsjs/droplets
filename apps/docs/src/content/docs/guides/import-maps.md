---
title: Shared libraries (import maps)
description: "Load a large library several droplets use once, from an import map: when it pays, declaring it external, mapping it in src/importmap.server.ts, /importmap and /importmap.js on the host page, the pitfalls, and vite dev."
---

Every droplet ships its own bundle, and Vite puts the libraries a droplet
imports into it. That is what you want for most code: a droplet loads only
what it needs. A large library that several droplets use is the exception. A
data grid or a chart engine of a few hundred kilobytes, bundled into five
droplets, is downloaded and parsed five times on a page that shows all five.

An import map fixes that. You leave the library out of the droplet bundles,
the droplets server tells the browser where to load it from, and every
droplet on the page shares the one copy.

## When it pays, and when it does not

Use an import map when:

- the library is large (a grid, a chart engine, an editor, a map), and
- more than one droplet imports it, or the host page already loads it.

Leave the library bundled when:

- it is small. A few kilobytes cost less than the extra request and the
  setup on every host page;
- only one droplet uses it. That droplet's bundle loads only where the
  droplet is, so the library already loads once;
- a host page has no control over its `<head>`. The map has to come before
  any module script on the page (see [On the host page](#on-the-host-page)).

Bundled code is also tree-shaken: a droplet gets only the parts of the
library it imports. A mapped library loads whole, as its CDN build ships it.

## How

Three steps: tell Vite the library is external, map it to a URL, and put the
map on the host page.

### 1. Declare the library external

Externals are plain Vite configuration. Put them on the client environment,
so only the browser bundles leave the library out:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { node } from "@dropletsjs/adapter-node";
import { svelte } from "@dropletsjs/renderer-svelte";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [svelte()] })],
  environments: {
    client: { build: { rolldownOptions: { external: ["ag-grid-community"] } } },
  },
});
```

The droplet bundles then keep `import … from "ag-grid-community"` as it is,
and the browser resolves that name through the import map. The plugin applies
the same externals under `vite dev`, so a droplet imports the same thing in
development and in production.

The server side does not change: the server renders with the package
installed in the droplets project, so keep it in `dependencies`.

List externals by name. A `RegExp` or a function in `external` works, but
the framework only learns which packages it matched once a droplet imports
them: in a build, from the bundles; under `vite dev`, once the browser has
loaded a droplet that imports one.

### 2. Map it in `src/importmap.server.ts`

The map comes from the `importmap` export of `src/importmap.server.ts` (or
`.js`). It is server code, called on every request for the map, and returns
the map as the browser reads it: `imports`, and `scopes` and `integrity` if
you need them.

```ts
// src/importmap.server.ts
import type { ImportMapHandler } from "$droplets/server";

export const importmap: ImportMapHandler = () => ({
  imports: {
    "ag-grid-community": "https://cdn.jsdelivr.net/npm/ag-grid-community@35.0.1/+esm",
  },
});
```

`importmap` receives one object:

| Field | What it is |
| --- | --- |
| `request` | The request for the map, as it reached the droplets server: headers and cookies included. |
| `url` | The request's URL on the droplet location: [`location`](/guides/configuration/#a-fixed-location) of the config, else a trusted `x-droplet-location` (or `Forwarded`, `X-Forwarded-*`), else the request's own origin. Path prefix included: `https://www.example.com/mfe/importmap`. |
| `externals` | The bare imports the client build leaves external, sorted: `["ag-grid-community"]`. |

Because it runs per request, the map can differ per request. Each host that
proxies the droplets server sends its own location, so `url` tells them apart.
Here intranet pages load the library from a mirror, and every other host from
the public CDN:

```ts
// src/importmap.server.ts
import type { ImportMapHandler } from "$droplets/server";

const VERSION = "35.0.1";

export const importmap: ImportMapHandler = ({ url }) => {
  const cdn = url.hostname.endsWith(".internal") ? "https://cdn.corp.internal/npm" : "https://cdn.jsdelivr.net/npm";
  return { imports: { "ag-grid-community": `${cdn}/ag-grid-community@${VERSION}/+esm` } };
};
```

With `location` fixed in the config, `url` is on that one location whatever
the request; read `request.headers` to tell requests apart.

Write absolute URLs. The browser resolves a relative one against the host
page, not the droplets server.

### 3. Use it in a droplet

A droplet imports the library as usual:

```svelte
<!-- src/droplets/price-grid/+droplet.svelte -->
<script module lang="ts">
  export const ssr = true;
  export const hydrate = true;
</script>

<script lang="ts">
  import { AllCommunityModule, createGrid, ModuleRegistry } from "ag-grid-community";
  import { onMount } from "svelte";
  import type { DropletProps } from "./$types";

  let { data }: DropletProps = $props();
  let grid: HTMLDivElement;

  onMount(() => {
    ModuleRegistry.registerModules([AllCommunityModule]);
    const api = createGrid(grid, {
      rowData: data.rows,
      columnDefs: [{ field: "name" }, { field: "price" }],
    });
    return () => api.destroy();
  });
</script>

<div bind:this={grid} style="height: 320px"></div>
```

```ts
// src/droplets/price-grid/+droplet.server.ts
export const load = () => ({
  rows: [
    { name: "Mug", price: 12 },
    { name: "Cap", price: 18 },
  ],
});
```

Its `client.js` now holds the droplet, not the grid. Every droplet that
imports `ag-grid-community` shares the copy the map points at.

## On the host page

The droplets server answers the map at two paths, and a host page uses one
of them:

| Path | Answer | For |
| --- | --- | --- |
| `/importmap` | The map as HTML: `<script type="importmap">{…}</script>` | A host page rendered on a server, which fetches it and writes it into the page's `<head>`, as it does with fragments. |
| `/importmap.js` | A classic script that inserts that same block into the page, right after itself | A page the browser assembles: a static HTML page, a single-page app. |

Whichever you use, it comes **before** `/index.js` and before any other module
script on the page. The browser resolves a module's imports while it fetches
it, so a map that arrives later is too late for it. Load `/importmap.js` as a
plain script: no `type="module"`, `defer` or `async`, which would all run it
after the modules have started.

### A static HTML page

```html
<head>
  <script src="/importmap.js"></script>
  <script type="module" src="/index.js"></script>
</head>
```

The paths are on your own origin when you proxy the droplets routes (see
[the paths to proxy](/integrate/any-stack/#the-paths-to-proxy)); add
`/importmap.js` to them. From the droplets server's own origin, write its URL:
`<script src="https://drops.example.com/importmap.js"></script>`. A classic
script loads from any origin without CORS.

### A server-rendered page

A page your server renders gets the block itself, with no extra request in
the browser. In PHP:

```php
<?php
// Next to the fragments: the same droplets server, the same x-droplet-location.
$context = stream_context_create(['http' => [
  'header' => "x-droplet-location: https://www.example.com\r\n",
  'ignore_errors' => true,
]]);
$importMap = file_get_contents('http://droplets:8000/importmap', false, $context);
if (!str_contains($http_response_header[0] ?? '', ' 200 ')) $importMap = '';
?>
<head>
  <?= $importMap ?>
  <script type="module" src="/index.js"></script>
</head>
```

With nginx Server Side Includes, proxy `/importmap` like the other droplets
routes and include it:

```nginx
location ~ ^/(index\.js$|env\.js$|index\.css$|importmap$|importmap\.js$|droplets/|assets/|api/) {
  proxy_pass http://droplets;
  proxy_set_header x-droplet-location https://www.example.com;
  proxy_set_header Forwarded "";
  proxy_set_header X-Forwarded-Host "";
  proxy_set_header X-Forwarded-Proto "";
  proxy_set_header X-Forwarded-Prefix "";
}
```

```html
<head>
  <!--# include virtual="/importmap" -->
  <script type="module" src="/index.js"></script>
</head>
```

### A client-only page

A single-page app is a module script itself. Put the map into its HTML
file, ahead of the app's own script: a browser that accepts one import map
only takes it before the first module loads.

```html
<!-- index.html of a Vite app -->
<head>
  <script src="https://drops.example.com/importmap.js"></script>
  <script type="module" src="/src/main.tsx"></script>
</head>
```

The app then loads `/index.js` as [a client-only page](/integrate/client-only/)
does. Fetching `/importmap` and inserting it with `innerHTML` does nothing:
the browser never runs a script inserted that way, an import map included.

## Pitfalls

### Content-Security-Policy

To the browser, an import map is an inline script, whichever path brought it:
the block from `/importmap` and the one `/importmap.js` inserts are both
checked against `script-src`. With a policy such as `script-src 'self'`, the
browser refuses the map, and every droplet that imports a mapped library fails
to load. Allow it with one of:

- the map's hash. The hash is over the JSON between the tags, the same for
  both paths, and stays the same as long as the map does. A map that differs
  per host has one hash per host:

  ```bash
  curl -s https://drops.example.com/importmap \
    | node -e 'const t = require("fs").readFileSync(0, "utf8").match(/^<script type="importmap">(.*)<\/script>$/s)[1];
        console.log(`sha256-${require("crypto").createHash("sha256").update(t).digest("base64")}`)'
  ```

  Put the printed value in `script-src` in single quotes:
  `script-src 'self' 'sha256-…'`.
- a nonce, for the block from `/importmap` only: your server writes it into
  the tag it inserts, `<script type="importmap" nonce="…">`. The block
  `/importmap.js` inserts carries no nonce.

`/importmap.js` itself is an external script: its origin has to be in
`script-src`, like the origin of `/index.js`.

### A page that already has an import map

Browsers that support several import maps on one page merge them into one, in
the order they are registered. When two maps name the same specifier, the
first one wins: the later rule is dropped, with a warning in the console. A
map registered after a specifier was resolved cannot change it either: that
import keeps what it resolved to. Some browser versions accept only one import
map, which has to come before any module loads (see the
[compatibility table](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap#browser_compatibility)).

So: if the host page maps the same library, its map and the droplets' map
must agree, or the one that comes first decides for both. Where the host's
visitors use browsers that take one map only, merge the two into one block on
your server: fetch `/importmap` and combine its JSON with your own.

### Two droplets servers on one page

Each droplets server has its own `/importmap`, and the page includes both.
If both map the same name, the first map wins, and the second server's
droplets run against the first server's version. When the versions can
differ, give each server's mapping a scope: a `scopes` entry applies to the
modules whose URL starts with its key, and each server's droplets load from
its own location.

```ts
// src/importmap.server.ts
import type { ImportMapHandler } from "$droplets/server";

export const importmap: ImportMapHandler = ({ url }) => ({
  scopes: {
    // The droplet location: https://www.example.com/mfe/ for a server under /mfe.
    [new URL(".", url).href]: {
      "ag-grid-community": "https://cdn.jsdelivr.net/npm/ag-grid-community@35.0.1/+esm",
    },
  },
});
```

Two servers behind the same origin need different locations (a path prefix
for at least one) so their scopes differ; where one scope's key starts with
the other's, the longer one applies. A scope only helps where the two versions can run side by side: the
page then loads the library twice.

### Caching

Both paths answer `Cache-Control: no-store`: the map is built per request,
so the browser and any proxy fetch it every time. It is a few hundred bytes;
the library it points at is what the CDN caches. A host page that inlines the
block from `/importmap` gets it with its own HTML, so cache the page as you
would without it.

The two paths are not static files: [`handle`](/guides/server/#handle) runs
for them, like for a fragment. A `handle` that answers anonymous requests with
a `401` takes the map down for them too; let the map's paths through. An error
in `importmap`, or a value that is not an object, answers `500` through
[`handleError`](/guides/server/#handleerror).

### The `importMap` option

`importMap` in `droplets.config.ts` sets where the map is served:

```ts
// droplets.config.ts
import { config } from "@dropletsjs/droplets";

export default config({
  importMap: "/vendor-map", // and /vendor-map.js
});
```

- Not set: `/importmap` and `/importmap.js`, only while the client build has
  externals.
- A path: that path and `<path>.js`, whether or not there are externals.
- `false`: neither is served.

The path starts with `/`, holds no `?`, `#` or space, stays outside `/`,
`/index.js`, `/env.js`, `/index.css`, `/droplets/`, `/assets/` and `/api/`,
and may not be the `health` path; anything else fails `vite dev` and
`vite build` with a `droplets:` message.

### A 404 for the map

Both paths answer `404` when:

- there is no `src/importmap.server.ts` (or `.js`), or it has no `importmap`
  export. A file named `.mts`, `.mjs`, `.cts` or `.cjs` is not loaded; Vite
  warns `src/importmap.server.mts is not loaded; name it src/importmap.server.ts or src/importmap.server.js`;
- `importMap` is not set and the client build has no externals;
- `importMap` is `false`.

A host page whose map answers `404` gets no map: `/importmap.js` fails to
load, and the droplets that import a mapped library fail too, with a
`TypeError` in the console: the browser cannot resolve the specifier.

### Version drift

The server renders a droplet with the version installed in the droplets
project; the browser hydrates it with the version the map points at. When
the two differ, the markup the server sent and what the browser renders can
differ, and hydration may not match. Pin the version in the URL, and change
it together with `package.json`. Under `vite dev`, the framework compares the
two when the URL names the version (`ag-grid-community@35.0.1`), as below.

## Under `vite dev`

The map is served the same way under `vite dev`, from the dev server, and the
dev page on `/` puts it in its own `<head>`. Two things differ.

**The `/@id/` spellings.** Vite serves a bare import it leaves alone under
`/@id/<name>`, so in development a droplet imports
`/@id/ag-grid-community` instead of `ag-grid-community`. The dev server adds
that spelling to every bare name in your map, pointing at the same URL:

```json
{
  "imports": {
    "ag-grid-community": "https://cdn.jsdelivr.net/npm/ag-grid-community@35.0.1/+esm",
    "/@id/ag-grid-community": "https://cdn.jsdelivr.net/npm/ag-grid-community@35.0.1/+esm"
  }
}
```

Map the bare name only; a built bundle never asks for `/@id/`.

**The warnings.** When the map is requested, the dev server checks its
`imports` (not `scopes`) and prints each problem once, ending with
`(warnImportMap: false hides this)`:

| Warning | What it means |
| --- | --- |
| `importmap: <name> is external but the import map does not map it; the browser cannot load it` | `<name>` is in the Vite externals, but not in the map. Droplets that import it fail in the browser. Map it, or take it out of `external` to bundle it again. |
| `importmap: the import map maps <name>, which is not external; it is bundled and the entry is unused` | The map names a package the droplets bundle themselves: the browser never asks for it. Add it to `external`, or drop the entry. |
| `importmap: <name>: the import map loads <a> in the browser, the server renders with <b>; hydration may not match` | The URL names version `<a>` (`<name>@<a>`), the droplets project has `<b>` installed. Bring them together. A URL without a version is not checked. |

`warnImportMap: false` in `droplets.config.ts` turns these off. A build never
prints them.
