# @dropletsjs/devtools

Development tools for [Droplets](https://dropletsjs.dev): a page at `/` for
working on one droplet at a time, and a floating dev tool for any page that
embeds droplets from `vite dev`. It applies to `vite dev` only: nothing of it
runs in `vite build` or `vite preview`.

```bash
pnpm add -D @dropletsjs/devtools@alpha
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { svelte } from "@dropletsjs/renderer-svelte";
import { node } from "@dropletsjs/adapter-node";
import { dropletsDevtools } from "@dropletsjs/devtools";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [svelte()] }), dropletsDevtools()],
});
```

## Details

### The devtools page

`/` in `vite dev` becomes a page for working on one droplet at a time. The
droplet gets the whole viewport. A panel floats above it: drag it, or fold it
into a pill with Alt+D; it remembers where it was. Pick a droplet, edit its
props with a builder or as JSON, send them by GET or POST, and see its flags,
renderer and files.

- `/`: client mode. The browser fetches the fragment and inserts it. The
  setup (droplet, method, editor, props) is kept in `localStorage`.
- `/?droplet=<id>&props=<json>&method=GET|POST`: server mode. The page
  arrives with the droplet already in it, as from a host that renders on the
  server, fetched through the droplets app and its hooks. Every change loads
  the page again; the setup lives in the URL.

The page answers `/` before the droplets app, so with this plugin the
`index` option has no effect in `vite dev`. Every other route stays with the
droplets app.

### The dev tool

A floating panel for any page that embeds droplets from `vite dev`, your own
host pages included. Turn it on with `dev.injectTool: true` in
`droplets.config.ts`, or per page with `index.js?injectTool=true`
(`?injectTool=false` turns it off for that page).

- One panel per page (`window.DropletsDevTools`), with a group per droplets
  server.
- Each droplet with its mode, renderer and state (waiting, loading, hydrated,
  mounted, error, static, empty). Hover to outline it on the page; click its
  name to scroll to it.
- Switch the hot-update strategy (`hmr`, `remount`, `reload`, `manual`) for
  the tab's session; under `manual`, Remount or Reload page when you are
  ready.
- Under `hmr`, the notices of a page (a droplet's new render contract, a
  `hooks.client.ts` edit) show in the panel, at the bottom left, instead of
  core's own toast.

The plugin also serves `/__droplets/devtools.json`, the element and the
droplets with their flags, which the tool reads from each server.

### API

- `dropletsDevtools()`: the Vite plugin. It takes no options and needs
  `droplets()` in the same plugin list.
- The types `DevtoolsPageInput` and `ServerRender`: what the page renders
  from.

### Changing this package

- `pnpm --filter @dropletsjs/devtools build` runs tsdown, then the tests: the
  plugin tests start a real `vite dev` over `packages/droplets/test/fixtures/app`
  and load `dist/client/devtools-page.js`, so `@dropletsjs/droplets` must be
  built first.
- `src/client/devtools-page.ts` and `src/tool/panel.ts` run in the browser;
  `src/index.ts` and `src/page.tsx` run in Node. `src/shared.ts` is plain
  functions both sides use.
- The page is Hono JSX (`hono/jsx`), rendered to a string.

## Facts

- `dropletsDevtools()` applies only when Vite's command is `serve` and it is not a preview. `src/index.ts:92`
- `dropletsDevtools()` throws `@dropletsjs/devtools: add droplets() from @dropletsjs/droplets/vite to the plugins too` when no plugin is named `droplets`. `src/index.ts:100`
- `dropletsDevtools()` reads the core plugin's `api` (`DropletsPluginApi`) in `configResolved`. `src/index.ts:97`
- `dropletsDevtools()` adds the package root to Vite's `server.fs.allow`. `src/index.ts:94`
- `dropletsDevtools()` hands the dev tool's URL, `/@fs/<package>/dist/tool/panel.js`, to the core with `api.setDevTool`. `src/index.ts:102`
- Devtools middleware is registered directly on Vite's middlewares, so it answers `/` before the droplets app. `src/index.ts:107`
- `GET /__droplets/devtools.json` answers `{ element, droplets }` as JSON with `cache-control: no-store`. `src/index.ts:109`, `src/index.ts:115`
- `/__droplets/devtools.json` sends `access-control-allow-origin: *`: the tool runs on host pages of any origin. `src/index.ts:114`
- Devtools page is served only for `GET /`; any other method or path goes to the next middleware. `src/index.ts:118`
- Devtools page answers `200` `text/html; charset=utf-8` with `cache-control: no-store`. `src/index.ts:143`
- Devtools page server mode is on when the query has a `droplet` key. `src/index.ts:125`
- Devtools page goes through `server.transformIndexHtml`, so Vite's client is injected. `src/index.ts:128`
- Devtools page's own `<style>` is added after `transformIndexHtml`, so Vite's PostCSS and the droplets scoping never touch it. `src/index.ts:126`, `src/index.ts:142`
- Devtools page errors are passed to `next(error)`. `src/index.ts:148`
- Devtools page origin for in-process fetches is `http://<Host header>`, else `http://localhost`. `src/index.ts:30`
- Devtools page includes the import map block fetched from `api.importMapPath()` through `api.fetch`; nothing when there is no path or the answer is not ok. `src/index.ts:37`, `src/index.ts:40`
- Server mode fetches the fragment in process through `api.fetch`, the droplets dev app with its hooks. `src/index.ts:54`
- Server mode inlines the answer only when its content type contains `text/html`; otherwise the stage is empty. `src/index.ts:65`
- Server mode links `/index.css` and `/droplets/<id>/style.css` in `<head>`, each only when it answers 200 (in dev `style.css` answers 404). `src/index.ts:59`
- Server mode with an unknown `droplet` id renders the first droplet; with no droplets it renders nothing. `src/shared.ts:189`, `src/index.ts:51`
- Tool state `method` is `POST` only for `method=POST`, else `GET`. `src/shared.ts:193`
- Tool state `mode` is `json` only for `mode=json`, else `builder`. `src/shared.ts:194`
- Tool state `props` that is not a JSON object is dropped: `{}`. `src/shared.ts:195`
- Fragment request GET puts props in the query; non-string values travel as JSON text, empty keys are skipped. `src/shared.ts:84`, `src/shared.ts:180`
- Fragment request POST sends `content-type: application/json` with the body `{ props }`. `src/shared.ts:169`
- Fragment request path is `/droplets/<id>` with the id URI-encoded. `src/shared.ts:168`
- Devtools page data is JSON in `<script type="application/json" id="dt-data">`, with `<` escaped as the JSON unicode escape `\u003c`. `src/page.tsx:47`, `src/page.tsx:197`
- Devtools page `strategy` defaults to `hmr` when the input has none. `src/page.tsx:162`
- Devtools page loads `<loaderUrl>?injectTool=true`: the dev tool is always on there. `src/page.tsx:203`
- Devtools page marks the loader script `vite-ignore`, so Vite does not pre-transform `index.js`; the attribute is gone after `transformIndexHtml`. `src/page.tsx:203`, `test/index.test.ts:81`
- Devtools page title is `Droplets devtools`. `src/page.tsx:182`
- The package entry exports `dropletsDevtools` and the types `DevtoolsPageInput` and `ServerRender`; `renderDevtoolsPage` lives in `src/page.tsx`, which the plugin alone calls. `src/index.ts:8`, `src/index.ts:135`
- `renderDevtoolsPage` with `pageStyles: false` leaves the page's `<style>` out for `withPageStyles`. `src/page.tsx:187`
- Client mode keeps its setup in `localStorage["droplets-devtools:client"]`; server mode keeps it in the URL. `src/client/devtools-page.ts:57`, `src/client/devtools-page.ts:68`
- Client mode renders again 250 ms after the last props edit. `src/client/devtools-page.ts:131`
- Client mode drops an answer when a newer render has started. `src/client/devtools-page.ts:385`
- Client mode inserts the fragment with `innerHTML`; a failing answer that is not HTML shows as text. `src/client/devtools-page.ts:395`, `src/client/devtools-page.ts:402`
- Server mode applies a change by loading the server-mode URL; the button reads `Apply and render`. `src/client/devtools-page.ts:134`, `src/client/devtools-page.ts:356`
- `droplets:update` and `droplets:registry` re-render the page (server mode reloads it) unless the strategy is `hmr`. `src/client/devtools-page.ts:436`, `src/client/devtools-page.ts:442`
- Page strategy is `sessionStorage["droplets:strategy:<origin>"]`, else the config's `dev.strategy`, else `hmr`. `src/client/devtools-page.ts:418`
- Page panel position is kept in `localStorage["droplets-devtools:panel"]`. `src/client/devtools-page.ts:490`
- Page panel starts folded when the window is narrower than 640 px. `src/client/devtools-page.ts:504`
- Page panel keeps at least 12 px of itself inside the viewport. `src/shared.ts:219`
- Page panel drag starts after 4 px of movement; less is a click. `src/client/devtools-page.ts:551`
- Alt+D folds and unfolds the page panel. `src/client/devtools-page.ts:574`
- Props warnings name the reserved query keys: `__cb`, `c`, `t`, `noSSR`, `clientOnly`, `__droplet_return`, any key starting with `/` or `__droplet_form_`. `src/shared.ts:131`, `src/shared.ts:140`, `src/shared.ts:148`
- Reserved query keys are the devtools' own copy of the runtime's `RESERVED_QUERY_KEYS`; `test/reserved-keys.test.ts` fails when the two differ. `src/shared.ts:131`, `test/reserved-keys.test.ts:24`
- Props warnings over GET say every value is sent as text when a value is not a string. `src/shared.ts:155`
- Dev tool creates one panel per page: the first module sets `window.DropletsDevTools`, later ones reuse it. `src/tool/panel.ts:257`
- Dev tool renders in an open shadow root on a `<droplets-devtools>` element appended to `document.body`. `src/tool/panel.ts:80`, `src/tool/panel.ts:240`
- Dev tool keeps open or closed in `localStorage["droplets-devtools:tool-open"]`; closed by default. `src/tool/panel.ts:18`, `src/tool/panel.ts:52`
- Dev tool fetches `<origin>/__droplets/devtools.json` per server with `cache: "no-store"`, again 150 ms after a change. `src/tool/panel.ts:232`, `src/tool/panel.ts:249`
- Dev tool lists the elements without flags when `devtools.json` fails. `src/tool/panel.ts:234`
- Dev tool strategy choices are `hmr`, `remount`, `reload` and `manual`, set per server through `source.setStrategy`. `src/tool/panel.ts:19`, `src/tool/panel.ts:186`
- Dev tool shows at most 3 notifications; the oldest goes first. `src/tool/panel.ts:21`, `src/tool/panel.ts:135`
- Dev tool notification without a reload button leaves after 10 s; one with it is an `alertdialog`. `src/tool/panel.ts:23`, `src/tool/panel.ts:112`
- Dev tool notification with the same `key` replaces the earlier one. `src/tool/panel.ts:105`
- `index.js` imports the dev tool when `?injectTool` is set to anything but `false`, else when `dev.injectTool` is on. `../droplets/src/runtime/dev-element.ts:704`
- `index.js` warns `the dev tool comes with @dropletsjs/devtools` when the tool is asked for without this plugin. `../droplets/src/runtime/dev-element.ts:693`
- The package exports `.` and `./package.json`. `package.json:21`
- Peer dependencies: `@dropletsjs/droplets` and `vite ^8.0.0`; `hono` is a dependency. `package.json:43`, `package.json:56`
- Build script runs tsdown, then the tests. `package.json:36`
- tsdown entries are `src/index.ts`, `src/client/devtools-page.ts` and `src/tool/panel.ts`. `tsdown.config.ts:6`
- graphCheck lists `client/devtools-page` and `tool/panel` as client entries, `index` and `page` as server code. `tsdown.config.ts:10`
- Plugin tests fail with `Build @dropletsjs/devtools first` when `dist/client/devtools-page.js` is missing. `test/index.test.ts:36`
