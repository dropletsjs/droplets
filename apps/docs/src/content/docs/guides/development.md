---
title: Development
description: "vite dev, the devtools page, framework HMR on any host page (dev.strategy hmr, remount, reload, manual), render-contract notices, the dev tool and the known limitations."
---

## The dev server

`vite dev` runs the droplet routes as middleware inside Vite's own server,
after Vite's own, and needs no adapter. Modules are transformed on demand;
`handle`, `+server.ts` routes and `handleError` are read again per request,
so edits appear without a restart, including adding or deleting a droplet
folder or an API route. Changing `droplets.config.ts`, `src/env.ts`, or
anything they import, restarts the server. Runtime variables come from the
`.env` files, as in Vite.

What differs from a build:

- `location` and `host` of the config are ignored: the location comes from
  each request (a trusted header, else the dev server's own origin), and
  `event.host` from the request too. A prerender entry without its own
  `host` is host-agnostic.
- Nothing is prerendered: listed `entries` props render live.
- Droplets have no `style.css` of their own (it answers `404`, fragments
  link none) and fragments send no `Link` header: Vite injects the styles
  (see [Known limitations](#known-limitations)).
- `/index.js` is generated per request, with the
  [hot-update](#hot-updates) client in it.

`vite preview` serves the production build through the adapter's preview:
Node, Bun and Deno run the Node adapter's app over `dist/`, with the routes
`node dist/server.js` would expose. Cloudflare has no preview (`vite preview`
warns and serves nothing): run `wrangler dev` after `vite build`. A build
with [`location`](/guides/configuration/#a-fixed-location) set writes its
URLs on that location under preview too, so a page under preview loads its
files from there.

### The dev log

`vite dev` and `vite build` print what the framework notices, prefixed
`[droplets:framework]`: a droplet folder that is not lowercase kebab-case, a
flag that is not a literal, flags an error page declares (in dev), an untrusted
location header, `"*"` in `trustedOrigins`, a missing `DROPLETS_SECRET`, a
malformed `x-droplet-props`. `DEV_DROPLETS_LOG` sets the level: `error`,
`warn`, `info` (the default) or `debug`. None of it reaches a production
bundle; a production server logs errors only
([Logging](/guides/deployment/#logging)).

## The devtools page

```bash
pnpm add -D @dropletsjs/devtools
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

When a file a droplet depends on changes, the plugin tells every page that
shows the droplet, over Vite's socket. A shared file (a component several
droplets import) reaches every droplet above it in the module graph.

This works on **any page that loads `index.js` from the dev server**, not
only the devtools page. A droplet embedded in your Rails app and served from
`localhost:5173` updates in place while you edit it. The host's page is
yours, not the dev server's, so no strategy but `"reload"` ever reloads it.
What happens on an edit depends on `dev.strategy`:

| Strategy | On a change |
| --- | --- |
| `"hmr"` (default) | The framework's own HMR, which keeps component state where it can. Load edits arrive as new data, and render-contract changes arrive as a notice. See the table below. |
| `"remount"` | The droplet loads again, by its flags as they are now, the way it reached the page. A server fragment is requested again with the same context and hydrates, or stays as the server rendered it when `hydrate = false`. An element the host wrote, or a `clientOnly` fragment, mounts in the browser. The host's children are carried over. State starts over. |
| `"reload"` | The page reloads, so a host that renders on the server renders again. |
| `"manual"` | Nothing; the console says which droplet changed. |

A page can override the strategy on its script tag, for that page only:

```html
<script type="module" src="http://localhost:5173/index.js?strategy=remount"></script>
```

Only `index.js` reads these parameters; fragments and the other routes are
unchanged.

### What `hmr` does

Stylesheets (imported CSS, CSS modules, the shared stylesheet) update live
through Vite's own CSS updates, with nothing remounted, under every strategy
but `"reload"`. A component's own styles follow its framework's HMR.

**A component edit**, in the component or in anything it imports:

| Renderer | What happens | State |
| --- | --- | --- |
| React | Fast Refresh | kept |
| Preact | Prefresh | kept |
| Vue | `@vitejs/plugin-vue` HMR. A template edit re-renders; a `<script>` edit reloads the component. | kept for a template edit; starts over for a script edit |
| Svelte 5 | `@sveltejs/vite-plugin-svelte` HMR swaps the component in place | starts over |
| Solid | solid-refresh swaps the component in place | starts over |
| Lit, Hono JSX | No HMR of their own. The droplet remounts in place, as under `"remount"`. | starts over |
| Handlebars | Not hydrated: the fragment is requested again and the markup swapped. Hydrated: the droplet remounts in place, as under `"remount"` | none to keep |
| Script | The previous cleanup runs, then the new `default(data, el)` runs on the same `el` | yours |

If no HMR of the framework takes an edit (React Fast Refresh, for example,
gives up on a module that also exports a non-component), the droplet remounts
in place, and the console says so. A droplet whose markup does not hydrate
(`hydrate = false`, or not hydrated yet) gets the server's new markup.

**A load edit** (`+droplet.server.ts`, `+droplet.ts`, or a module only they
import): the loads run again, through `_data` as on any render, and the live
component receives the new `data` without a remount. Its state is kept. A
Vue component whose `setup` awaits `props.data` remounts instead, and a
script droplet runs its cleanup and its function again.

**A render-contract change** (`ssr`, `hydrate` or `prerender` in the
droplet's flags) leaves the droplet on the page as it is. A notice names the
droplet and the change, for example *counter changed its render contract:
hydrate true → false*:

| Change | What happens |
| --- | --- |
| `ssr` false → true | A notice with **Reload page**. The host has to ask for the fragment again to get the server's markup. |
| `ssr` true → false | A notice. |
| `hydrate` false → `true`, `"visible"` or `"interactive"` | The droplet hydrates live, in the new mode, and a notice says so. |
| `hydrate` on → false | A notice with **Reload page**. The running component stays live until then. |
| `hydrate` between modes | Not hydrated yet: the droplet waits in the new mode. Already hydrated: a console line only. |
| `prerender`, either way | A notice. Prerendering happens in `vite build`, so check it with `vite preview`. |

An edit to `src/hooks.client.ts` gets a notice with **Reload page** as well:
`init()` runs once per page, before any droplet.

Notices show in the [dev tool](#the-dev-tool) when it is on the page.
Otherwise they show as a small toast in the corner of the page, in its own
shadow root, out of the host's styles. A notice with a button is an alert
dialog. One without is a status that closes after ten seconds. Every notice
can be dismissed with its × button, or with Escape while it has focus. A
newer notice about the same flags of the same droplet replaces the older
one, and no more than three show at once. Each notice also writes one line
to the console. None of this exists outside `vite dev`; nothing of it
reaches a build.

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
- **Notices** of `hmr` (a new render contract, a `hooks.client.ts` edit)
  show at the bottom left of the page, under the panel's styles.

## Workspace development

In the droplets repository itself, the example imports the packages' compiled
`dist/`:

```bash
pnpm install
pnpm build          # compile every package
pnpm dev            # the Svelte example on :5173
pnpm dev:lib        # in a second terminal: rebuild dist/ on save
pnpm check          # biome, build, typecheck, integration tests, the examples, the demo
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

**Files in dev.** Imported files and CSS `url()`s are on the dev server
itself, absolute (`http://localhost:5173/src/lib/logo.png`): the plugin sets
Vite's `server.origin` to the dev server's address unless you set one, so a
host page on another origin loads them. They ignore a location's path prefix:
`vite dev` serves its modules from its root, so try a prefixed proxy against a
build (`vite preview`). Stylesheets
are not linked inside the element as in a build: Vite injects them into the
host page's `<head>` as `<style>` elements. `public/` is served at
`/assets/public/*` as in a build, and Vite also serves it at the root
(`/robots.txt`), which a build does not.

**Scoped styles of non-hydrating droplets in dev.** In dev, a component's
styles reach the browser through the droplet's client module. A droplet with
`hydrate = false` never loads that module, so it renders without its component
styles in dev, and with them in a build. The shared stylesheet, Tailwind
included, is unaffected: Vite injects it with `/index.js`.

**Flags are read before compiling.** They must be literals in the
component; see [Flags](/guides/writing-droplets/#flags).

**State across a component edit.** Under `hmr`, React and Preact keep hook
state, and Vue keeps it for a template edit. Svelte 5, Solid, Lit and Hono JSX
start the component over: their HMR, or the remount, creates a new instance.
The data stays the same either way.

**Load edits in Vue and Solid.** A Vue component whose `setup` awaits
`props.data` remounts on a load edit, so its state starts over. New `data`
reaches a Solid component through its props, so only a component that reads
`props.data` where Solid tracks it (in JSX, a memo) shows it. A component
that reads it once at setup keeps the old data until its next edit.

**`prerender` in dev.** `vite dev` renders every request, so a change to
`prerender` shows only in a build: check it with `vite preview`.

**The devtools page under `hmr`.** The page leaves an edit to the droplet it
shows. The droplet's own HMR updates it, and the page itself does not render
again.

**Remounting a `noSSR` fragment.** A host's `?noSSR` request cannot be told
apart from `ssr = false`; on a remount the fragment is requested without it.
