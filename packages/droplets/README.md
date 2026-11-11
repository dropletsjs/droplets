# @dropletsjs/droplets

Server-rendered components you can embed from any stack, as a Vite plugin on
Hono. Each droplet is one component with its own URL: server-rendered,
independently bundled, embeddable as an HTML fragment into a page served by
anything. Components are written in Svelte, Vue, Solid, React, Preact, Hono JSX,
Handlebars or Lit, through renderers.

The full guide: [dropletsjs.dev](https://dropletsjs.dev).

## Install

The quickest start is a new project:

```bash
npm create droplets@alpha my-widgets
```

By hand:

```bash
pnpm add @dropletsjs/droplets@alpha @dropletsjs/renderer-svelte@alpha svelte
pnpm add -D vite typescript @dropletsjs/adapter-node@alpha @dropletsjs/devtools@alpha
```

Node 22+ and Vite 8. Pick the renderers you need:

| Renderer | Package | Files |
| --- | --- | --- |
| `svelte()` | `@dropletsjs/renderer-svelte` | `.svelte` |
| `vue()` | `@dropletsjs/renderer-vue` | `.vue` |
| `solid()` | `@dropletsjs/renderer-solid` | `.tsx`, `.jsx` |
| `react()` | `@dropletsjs/renderer-react` | `.tsx`, `.jsx` |
| `preact()` | `@dropletsjs/renderer-preact` | `.tsx`, `.jsx` |
| `honoJsx()` | `@dropletsjs/renderer-hono-jsx` | `.tsx`, `.jsx` |
| `handlebars()` | `@dropletsjs/renderer-handlebars` | `.hbs` |
| `lit()` | `@dropletsjs/renderer-lit` | `.lit.ts`, `.lit.js` |

The adapter decides what `vite build` emits: `@dropletsjs/adapter-node` for
`dist/server.js`, `@dropletsjs/adapter-cloudflare` for a Worker,
`@dropletsjs/adapter-bun` and `@dropletsjs/adapter-deno` for those runtimes.

## Set up

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { svelte } from "@dropletsjs/renderer-svelte";
import { dropletsDevtools } from "@dropletsjs/devtools";
import { node } from "@dropletsjs/adapter-node";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [svelte()] }), dropletsDevtools()],
});
```

```ts
// droplets.config.ts (optional)
import { config } from "@dropletsjs/droplets";

export default config({ element: "my-widgets", cors: true });
```

```json
// tsconfig.json
{
  "extends": "./.droplets/tsconfig.json",
  "compilerOptions": { "types": ["vite/client", "@dropletsjs/droplets/ambient"] }
}
```

`.droplets/` holds each droplet's generated `./$types`; `vite` writes it, and
so does `djs sync` (`"prepare": "djs sync"`). `vite` to develop, `vite build`
to build, `node dist/server.js` to run. `djs add <name>` writes a new
droplet.

## A droplet

```
src/droplets/<name>/
  +droplet.<ext>       # the component
  +droplet.server.ts   # load, actions, handleError, entries, transform (server only)
  +droplet.ts          # props schema, load, handleError (server and browser)
  +error.<ext>         # the error page, in the same framework
```

```svelte
<!-- src/droplets/hello/+droplet.svelte -->
<script module lang="ts">
  export const hydrate = "visible"; // true | false | "visible" | "interactive"
</script>

<script lang="ts">
  import type { DropletProps } from "./$types";
  let { data, children }: DropletProps = $props(); // data: { who: string }, from the load
</script>

<h1>Hello {data.who}!</h1>
{@render children?.()}
```

```ts
// src/droplets/hello/+droplet.server.ts
import { error } from "$droplets/server";
import type { LoadEvent } from "./$types";

export const load = ({ props }: LoadEvent) => {
  const who = typeof props.who === "string" ? props.who : "world";
  if (who.length > 40) error(404, "Nobody with a name that long lives here.");
  return { who };
};
```

- Flags (`ssr`, `hydrate`, `prerender`) are literal exports, read before
  anything is compiled. The error page follows the droplet's flags.
- The server load's result is inlined into the fragment; hydration needs no
  second request. A load may return promises; a droplet mounted from scratch
  gets `data` as a promise.
- `error()` and `redirect()` answer like an endpoint. Anything else a load
  throws goes through `handleError` to `+error.*`.
- `actions` in `+droplet.server.ts` take form posts; `actionUrl()` from
  `$droplets/form` is where a form posts. Without JavaScript the answer is a
  `303` back to the host page with the result signed in its URL (set
  `DROPLETS_SECRET`, 32+ bytes); `enhanceDropletForm` posts by `fetch`.

## Embed it

```html
<script type="module" src="https://drops.example.com/index.js"></script>

<!-- the body of GET https://drops.example.com/droplets/hello?who=Ana, pasted in -->
<my-widgets data-droplet="hello">…</my-widgets>
```

| Route | Returns |
| --- | --- |
| `GET`/`POST /droplets/:id` | The fragment; a form body runs an action |
| `GET`, `POST /droplets/:id/_data` | `{ "data": … }` |
| `GET /droplets/:id/client.js`, `/style.css` | Bundle and styles |
| `GET /index.js`, `/index.css` | Entry client, shared stylesheet |
| `ALL /api/*` | `+server.ts` endpoints |
| `GET /health` | `ok` |

A host fetching fragments through an internal address sends the public
location in `x-droplet-location`, with its origin listed in `origin` (or
`DROPLETS_ORIGIN`). Pages on other origins need `cors: true`.

## Also in the box

- `src/hooks.server.ts`: `handle` and `handleError`.
- `src/api/**/+server.ts`: endpoints under `/api/`.
- `src/env.ts`: typed environment variables, read from `$droplets/env/public`
  and `$droplets/env/private`.
- `src/importmap.server.ts`: import maps for libraries kept out of the bundles.
- `$droplets/server`: `json`, `text`, `error`, `redirect`, `fail`,
  `sequence`, `hostFrom`; `$droplets/drop`: the droplets server's location,
  for `fetch(droplet.url("/api/…"))`; `$droplets/form`: `actionUrl` and
  `enhanceDropletForm`.
- `trustedOrigins`, the `Origin` check on form posts, body limits and
  `event.cookies`: see the
  [Security model](https://dropletsjs.dev/guides/security/).
- `@dropletsjs/droplets/postcss`: the PostCSS plugin that scopes the global
  stylesheet to the droplet element.
- `@dropletsjs/droplets/testing`: `rendererConformance()` and
  `fakeRenderer()`, for renderer authors.
- In `vite dev`: hot updates on any page that embeds a droplet, never
  reloading it. With `dev.strategy: "hmr"` (the default) a component edit
  goes through the framework's own HMR (React Fast Refresh, Prefresh, Vue,
  Svelte, solid-refresh), keeping state where that HMR does. Lit and Hono
  JSX remount in place, and a load edit brings new data to the live
  component. A new `ssr`, `hydrate` or `prerender` shows a notice. Also a
  dev tool for host pages (`dev.injectTool`).

## Known limitations

- Flags must be literals.
- In dev, a droplet with `hydrate = false` renders without its component
  styles (they arrive with the client module it never loads); a build has
  them.

MIT
