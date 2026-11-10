---
title: Development
description: "vite dev, the devtools page, hot updates on any host page, the dev tool and the known limitations."
---

## The dev server

`vite dev` runs the droplet routes as middleware inside Vite's own server.
Modules are transformed on demand and the SSR module is re-evaluated per
request, so edits appear without a restart, including adding or deleting a
droplet folder. Changing `droplets.config.ts`, or anything it imports,
restarts the server.

`vite preview` serves the production build through the adapter's preview, with
the routes `node dist/server.js` would expose. Use it to check a build before
deploying.

## The devtools page

```bash
pnpm add -D @dropletsjs/devtools@alpha
```

```ts
// vite.config.ts
import { dropletsDevtools } from "@dropletsjs/devtools";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [svelte()] }), dropletsDevtools()],
});
```

With it, `/` in `vite dev` is a page for working on one droplet at a time. The
droplet gets the whole viewport; a panel floats above it, can be dragged or
folded into a pill (Alt+D), and remembers where it was. Pick a droplet, edit
its props with a builder or as JSON, send them by GET or POST, and see its
flags, renderer and files. The page re-renders when the droplet or the
registry changes, and shows error pages as they are.

- **Client mode** (`/`): the browser fetches the fragment and inserts it.
- **Server mode** (`/?droplet=<id>&props=<json>&method=GET|POST`): the page
  arrives with the droplet already in it, as from a host that renders on the
  server.

The devtools never run in `vite build` or `vite preview`; nothing of them
reaches a build.

## Hot updates

Inside a droplet, the framework's own HMR works as usual (Svelte, Vue, Solid
refresh, React Fast Refresh). On top of that, when a file a droplet depends on
changes, the plugin tells every page that shows it, over Vite's socket. A
shared file (a component several droplets import) reaches every droplet above
it in the module graph.

That works on **any page that loads `index.js` from the dev server**, not only
the devtools page: a droplet embedded in your Rails app, served from
`localhost:5173`, updates in place while you edit it. What it does is
`dev.strategy`:

| Strategy | On a change |
| --- | --- |
| `"remount"` (default) | The droplet loads again, by its flags as they are now, the way it reached the page. A server fragment is requested again with the same context and hydrates (or stays as the server rendered it, with `hydrate = false`); an element the host wrote, or a `clientOnly` fragment, mounts in the browser. The host's children are carried over. |
| `"reload"` | The page reloads, so a host that renders on the server renders again. |
| `"manual"` | Nothing; the console says which droplet changed. |

A page overrides it on its script tag, for that page only:

```html
<script type="module" src="http://localhost:5173/index.js?strategy=reload"></script>
```

Only `index.js` reads these parameters; fragments and the other routes are
unchanged.

## The dev tool

The dev tool is a floating panel for pages that embed droplets: your host
pages, not only the devtools page. Turn it on for every page with
`dev.injectTool: true`, or for one page:

```html
<script type="module" src="http://localhost:5173/index.js?injectTool=true"></script>
```

(`?injectTool=false` turns it off for that page.) The devtools page always has
it. It needs `dropletsDevtools()` in the Vite config; without it,
`injectTool` warns in the console.

- **One panel per page**, `window.DropletsDevTools`, in a shadow root. A page
  that embeds droplets from several dev servers gets one group per server.
- Each group lists that server's droplets on the page in document order, with
  their mode (flags and `data-hydrate`), renderer and state: waiting, loading,
  hydrated, mounted, error, static, empty. Hovering one outlines it on the
  page; its name scrolls to it.
- The **strategy** can be switched per server for the tab's session. Under
  `manual`, a changed droplet is marked, and **Remount** or **Reload page**
  load it again.

## Workspace development

In the droplets repository itself, the example imports the packages' compiled
`dist/`:

```bash
pnpm install
pnpm build          # compile every package
pnpm dev            # the Svelte example on :5173
pnpm dev:lib        # in a second terminal: rebuild dist/ on save
pnpm check          # build, typecheck, test, build the example
```

## Known limitations

**Other origins in dev.** A host page on another origin can load droplets from
`vite dev`; Vite's dev server allows `localhost` and `127.0.0.1` origins by
default. A host on another hostname needs `server.cors` in `vite.config.ts`
(and `cors` in `droplets.config.ts`, as in production). Name the host rather
than allowing every origin: `server.cors: true` lets any site you visit read
the dev server's sources while it runs.

```ts
// vite.config.ts
export default defineConfig({
  server: { cors: { origin: ["http://shop.local:8080"] } },
  plugins: [droplets({ renderers: [svelte()] })],
});
```

**Scoped styles of non-hydrating droplets in dev.** In dev, a component's
styles reach the browser through the droplet's client module. A droplet with
`hydrate = false` never loads that module, so it renders without its component
styles in dev, and with them in a build. The shared stylesheet, Tailwind
included, is unaffected: Vite injects it with `/index.js`.

**Flags are read textually.** They must be literals; see
[Flags](/guides/writing-droplets/#flags).

**Remounting a `noSSR` fragment.** A host's `?noSSR` request cannot be told
apart from `ssr = false`; on a remount the fragment is requested without it.
