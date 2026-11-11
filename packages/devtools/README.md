# @dropletsjs/devtools

Development tools for [Droplets](https://dropletsjs.dev). Active in
`vite dev` only: nothing of it runs in `vite build` or `vite preview`.

```bash
pnpm add -D @dropletsjs/devtools@alpha
```

```ts
// vite.config.ts
import { droplets } from "@dropletsjs/droplets/vite";
import { dropletsDevtools } from "@dropletsjs/devtools";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [svelte()] }), dropletsDevtools()],
});
```

## The devtools page

`/` in `vite dev` becomes a page for working on one droplet at a time. The
droplet gets the whole viewport. A panel floats above it: drag it, or fold it
into a pill with Alt+D; it remembers where it was. Pick a droplet, edit its
props with a builder or as JSON, send them by GET or POST, and see its flags,
renderer and files.

- `/`: client mode. The browser fetches the fragment and inserts it.
- `/?droplet=<id>&props=<json>&method=GET|POST`: server mode. The page
  arrives with the droplet already in it, as from a host that renders on the
  server.

## The dev tool

A floating panel for any page that embeds droplets from `vite dev`, your own
host pages included. Turn it on with `dev.injectTool: true` in
`droplets.config.ts`, or per page with `index.js?injectTool=true`.

- One panel per page (`window.DropletsDevTools`), with a group per droplets
  server.
- Each droplet with its mode, renderer and state (waiting, loading, hydrated,
  mounted, error, static, empty). Hover to outline it on the page.
- Switch the hot-update strategy (`hmr`, `remount`, `reload`, `manual`) for
  the tab's session; under `manual`, Remount or Reload page when you are
  ready.
- Under `hmr`, the notices of a page (a droplet's new render contract, a
  `hooks.client.ts` edit) show in the panel, at the bottom left, instead of
  core's own toast.

The plugin also serves the tool's module and `/__droplets/devtools.json`, the
droplets and their flags.

MIT
