# Droplets docs

The guide at https://dropletsjs.dev, built with
[Astro Starlight](https://starlight.astro.build). Some pages embed real
droplets from [apps/demo](../demo), fetched from a running demo server at
build and hydrated in the browser from the demo's origin.

```bash
pnpm docs:dev       # http://localhost:4321, with the demo's dev server on :5180
pnpm docs:build     # static site in apps/docs/dist, built against a local demo server
pnpm docs:check-csp # after docs:build: every inline script hash is in public/_headers
```

Run `pnpm build` at the root first: `docs:build` builds the demo, which needs
the packages' `dist/`. Under a coding agent, unset its variables, or Astro
backgrounds `astro dev`:
`env -u CLAUDECODE -u AI_AGENT -u CLAUDE_CODE_ENTRYPOINT pnpm docs:dev`.

## Details

### Pages and the sidebar

Pages live in `src/content/docs/`, the only folder Starlight reads
(`docsLoader()` in `src/content.config.ts`). The sidebar, in reading order,
is listed in `astro.config.mjs`; a new page goes there too, since the pages'
"Next" links follow it:

1. Start here (what a droplet is, the ways to use Droplets, setup)
2. Writing droplets
3. Renderers (Overview, then one page per renderer, plain script included)
4. Integrating (any stack, a client-only page, the HTTP contract, Known
   hosts with one page per host, WordPress)
5. In the browser
6. Deployment
7. Security
8. Reference (API, contributing)

Link between pages with root-relative paths (`/guides/configuration/`). The
build prefixes them with the site's base path (`src/plugins/base-links.mjs`),
so the same pages work at the root of a domain and under a sub-path.

### Live droplets

Pages embed real droplets from [apps/demo](../demo) with
`<LiveDroplet id="hello" props={{ who: "Ana" }} />`
(`src/components/LiveDroplet.astro`). The docs act as their host:

- **At build**, each one's fragment is fetched from the demo server
  (`POST /droplets/<id>` with the page as `host` and the props, and
  `x-droplet-location` set to the demo's public origin) and inlined, as a
  server-side include. A page view never asks the demo to render.
  `pnpm docs:build` runs `scripts/with-demo.mjs`: it builds apps/demo for
  Node, starts it on a free port with a `DROPLETS_SECRET` of its own, builds
  the site with `DEMO_URL` pointing at it, and stops it. Without a demo
  server the build fails, and so does a page whose droplet answers anything
  but its fragment.
- **In the browser**, the page loads `/index.js` from the demo's public
  origin (`DEMO_PUBLIC_URL`), which hydrates the fragments with the inline
  data and loads their bundles and stylesheets from there. The poll's
  enhanced form posts to the demo, and the `_data` refresh after it, by
  `fetch`: the demo answers CORS for the docs' origins only and lists them in
  `trustedOrigins`.
- **Limits.** A page only hydrates fragments of the demo build its
  `/index.js` comes from: after a demo deploy, the inlined fragments are
  stale until the docs are built again, and `LiveDroplet` swaps each for an
  element that renders in the browser from the live build (one `_data`
  request each). A vote posted without JavaScript goes to the demo and comes
  back to the page (Post/Redirect/Get), but a static page cannot render the
  result its URL carries. The crash droplet's two renders are both fetched
  at build; its button shows one or the other.

The renderer pages (`src/content/docs/renderers/`) use `RendererDemo`
(`<RendererDemo id="counter-vue" />`): the demo's `counter-<renderer>`
droplet live, next to its source files, read from `apps/demo` at build with
`?raw`. Their "Add it to a project" steps come from `AddRenderer`, which runs
`djs add`'s own catalog and config edit (`packages/droplets/src/add/`). The
Expressive Code options live in `ec.config.mjs`, not `astro.config.mjs`, so
the `<Code>` those components render gets them too.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DEMO_URL` | set by `scripts/with-demo.mjs` and `scripts/dev.mjs` | Where the build fetches fragments. Set it to use a running demo instead (nothing is built or started). |
| `DEMO_PUBLIC_URL` | `https://demo.dropletsjs.dev` | Where browsers load the demo from: `/index.js`, and the `x-droplet-location` of the fragments. |

`pnpm docs:dev --port 4400` passes the port to the demo's dev server as
`DOCS_PORT`, so the demo trusts that origin too.

### CSP

`public/_headers` holds the site's Content-Security-Policy. `script-src`
lists the sha256 of each inline script Starlight writes; the docs' own
component scripts are always bundled to files under `/_astro/`, never
inlined (`assetsInlineLimit` in `astro.config.mjs`), so editing a component
never changes the hashes. The demo origin is allowed in `script-src`,
`style-src`, `connect-src` and `form-action`, and nowhere else.

`docs:check-csp` (`scripts/csp-hashes.mjs`) prints the `script-src` hashes
the build needs and fails when `_headers` misses one or lists a stale one,
when the demo origin is missing from one of those four directives, or when
any directive names another host. After a Starlight or Astro upgrade, paste
the printed set into `_headers`. CI runs it after every docs build.

### Diagrams

Each explanatory figure is an `.astro` component in `src/components/` that
lays its content out twice with `diagram-kit.ts`, a wide scene (620 px) for
the content column and a narrow one (360 px) for phones, and passes both to
`Diagram.astro`. The figure is a size container: below 620 px of column it
shows the narrow scene, so a scene is never shrunk under its own size and
its type stays at 12.5 px or more. Colors are the `--djs-*` tokens, so a
figure follows Starlight's light and dark theme.

`Diagram.astro` is the one place for what every figure has: `role="img"`
with the title as its label and the description as `<desc>`, the caption,
and two buttons, shown once its script runs. "Full screen" opens a
`<dialog>` with the scene on screen: wheel, pinch or drag to zoom and pan,
`+`, `-`, `0` and the arrows on the keyboard, `Esc` or the close button to
leave. "SVG" downloads that scene as a file of its own, its computed colors
and fonts written into it and the page's background behind it.

| Figure | Page |
| --- | --- |
| `RenderModes` | Writing droplets, Flags |
| `RunsWhere` | Writing droplets, Where code runs |
| `FormFlow` | Form actions, Post/Redirect/Get |
| `PrerenderLookup` | Prerendering, `host` at build |
| `LocationFlow` | HTTP contract, Where it comes from |
| `HostsHub` | Known hosts |
| `ShopPage`, `ShopFlow` | Shop demo |
| `WordPressFlow` | WordPress, step 3 |
| `ElementLifecycle` | In the browser, What happens on connect |
| `BrowserLoads` | Deployment, Behind a proxy |

`DropletAnatomy` (an interactive explorer of the fragment) and
`DropletTour` (the home page's video) are not diagrams and keep their own
markup.

### Videos and the tour's poster

`public/hosts/` holds each host's recorded video and screenshots
(`pnpm test:hosts --docs`, see [tests/hosts](../../tests/hosts/README.md))
and the droplet tour on the home page, `tour.mp4` (`--tour --docs`). The
tour's poster, `tour.webp`, is drawn, not recorded: `scripts/poster/gen.mjs`
writes `tour-poster.svg` (a wireframe of the shop's gallery on a WordPress
page, its droplets outlined, in the docs' dark tokens and fonts) and
`render.mjs` turns it into the WebP in Playwright's Chromium. It has no play
button: the page draws its own (`src/components/DropletTour.astro`).

```bash
node apps/docs/scripts/poster/gen.mjs && node apps/docs/scripts/poster/render.mjs
```

### Deploying

The site is an assets-only Cloudflare Worker (`wrangler.jsonc`):
`apps/docs/dist` served as static assets on the custom domain, with the
response headers of `public/_headers`. It is deployed by hand, not from CI.

The fragments must come from the demo build that is live, so deploy the demo
first ([apps/demo](../demo/README.md#deploying)), then build the docs against
it:

```bash
DEMO_URL=https://demo.dropletsjs.dev pnpm docs:build
pnpm docs:check-csp
cd apps/docs && npx wrangler deploy
```

### Anywhere else

Any static host works. Two environment variables tell the build where it
will be served:

| Variable | Default | Meaning |
| --- | --- | --- |
| `DOCS_SITE` | `https://dropletsjs.dev` | The origin, for canonical links and the sitemap. |
| `DOCS_BASE` | `/` | The sub-path, when the site is not at the root of its origin. |

```bash
DOCS_SITE=https://example.github.io DOCS_BASE=/droplets pnpm docs:build
```

The output directory is `apps/docs/dist`; Node 22 or newer.

## Facts

- `pnpm docs:dev` runs `node scripts/dev.mjs` in this package. `../../package.json:21`, `package.json:8`
- `pnpm docs:build` runs `node scripts/with-demo.mjs astro build`. `../../package.json:22`, `package.json:9`
- `pnpm docs:check-csp` runs `scripts/csp-hashes.mjs`. `../../package.json:24`
- Docs `typecheck` is `astro check`. `package.json:12`
- Node version: the repository requires Node 22 or newer. `../../package.json:9`
- Content collection: Starlight's `docsLoader()`, which reads `src/content/docs/` only. `src/content.config.ts:6`
- Sidebar order is the `sidebar` constant, passed to Starlight; the "Next" links and the page order of `llms-full.txt` follow it. `astro.config.mjs:23`, `astro.config.mjs:114`, `astro.config.mjs:117`
- Sidebar groups, in order: Start here, Writing droplets, Renderers, Integrating, In the browser, Deployment, Security, Reference. `astro.config.mjs:25`, `astro.config.mjs:29`, `astro.config.mjs:41`, `astro.config.mjs:57`, `astro.config.mjs:83`, `astro.config.mjs:84`, `astro.config.mjs:85`, `astro.config.mjs:86`
- Sidebar Renderers group: Overview, Svelte, Vue, React, Preact, Solid, Hono JSX, Handlebars, Lit, plain script; collapsed. `astro.config.mjs:42`
- Sidebar Integrating group: any stack, a client-only page, HTTP contract, Known hosts (collapsed, one page per host plus the shop demo), WordPress. `astro.config.mjs:59`, `astro.config.mjs:60`, `astro.config.mjs:63`, `astro.config.mjs:80`
- `DOCS_SITE` defaults to `https://dropletsjs.dev`, `DOCS_BASE` to `/`. `astro.config.mjs:10`, `astro.config.mjs:11`
- `trailingSlash` is `"always"`. `astro.config.mjs:95`
- Component scripts of `src/components/*.astro` are never inlined (`assetsInlineLimit` returns `false` for them). `astro.config.mjs:17`, `astro.config.mjs:20`
- `vite` stays external at prerender time, for `AddRenderer`'s `parseAst`. `astro.config.mjs:100`
- Sidebar Start here group: what is a droplet, ways to use Droplets, getting started, manual setup. `astro.config.mjs:26`
- `starlight-llms-txt` writes `/llms.txt`, `/llms-full.txt` and `/llms-small.txt` at build, pages in sidebar order (`promote`). `astro.config.mjs:116`, `astro.config.mjs:117`
- `llms-*.txt` leave out the live droplets (`.live-droplet`) and the heading anchor links (`.sl-anchor-link`). `astro.config.mjs:119`
- Base links: after the build, root-relative `<a href>` get the `base` prefix; nothing changes when `base` is `/`. `src/plugins/base-links.mjs:23`, `src/plugins/base-links.mjs:24`
- Expressive Code options live in `ec.config.mjs` (themes `github-dark`, `github-light`). `ec.config.mjs:12`
- `docs:dev` starts the demo's dev server (`pnpm run dev` in `../demo`) with `DOCS_PORT`. `scripts/dev.mjs:37`
- `docs:dev` `DOCS_PORT` is the `--port` passed to astro dev, else 4321. `scripts/dev.mjs:17`
- `docs:dev` waits up to 30 s for `http://localhost:5180/health` before starting astro dev. `scripts/dev.mjs:12`, `scripts/dev.mjs:40`
- `docs:dev` runs astro dev with `DEMO_URL` and `DEMO_PUBLIC_URL` both `http://localhost:5180`. `scripts/dev.mjs:54`
- `docs:dev` stops both servers when either exits. `scripts/dev.mjs:30`
- `with-demo.mjs` with `DEMO_URL` already set builds and starts nothing and runs the command against it. `scripts/with-demo.mjs:38`
- `with-demo.mjs` fails unless `packages/droplets/dist/vite.js` exists: run `pnpm build` first. `scripts/with-demo.mjs:46`
- `with-demo.mjs` builds the demo with `DROPLETS_ADAPTER=node`. `scripts/with-demo.mjs:50`
- `with-demo.mjs` starts the demo's `dist/server.js` on a free `127.0.0.1` port. `scripts/with-demo.mjs:57`, `scripts/with-demo.mjs:64`
- `with-demo.mjs` demo env: a random 32-byte `DROPLETS_SECRET`, `DROPLETS_TRUSTED_ORIGINS` set to the `DEMO_PUBLIC_URL` origin, so the `x-droplet-location` the docs send is trusted. `scripts/with-demo.mjs:71`, `scripts/with-demo.mjs:76`
- `with-demo.mjs` waits up to 20 s for the demo's `/health`; a demo that exits or never answers fails the run. `scripts/with-demo.mjs:90`, `scripts/with-demo.mjs:92`
- `with-demo.mjs` runs the command with `DEMO_URL` and `DEMO_PUBLIC_URL`, stops the demo, and prints its log on failure. `scripts/with-demo.mjs:104`, `scripts/with-demo.mjs:106`
- `DEMO_PUBLIC_URL` defaults to `https://demo.dropletsjs.dev`. `src/components/live-droplet.ts:19`, `scripts/with-demo.mjs:43`
- `DEMO_URL` unset: a page with a live droplet throws at build. `src/components/live-droplet.ts:39`
- `DEMO_URL` and `DEMO_PUBLIC_URL` must be `http(s)` URLs. `src/components/live-droplet.ts:29`
- Live droplet element: the demo renders in `<djs-demo>`. `src/components/live-droplet.ts:17`
- Live droplet fetch: `POST <DEMO_URL>/droplets/<id>`, JSON `{ host, props }`, `accept: text/html`, `x-droplet-location: <DEMO_PUBLIC_URL>`. `src/components/live-droplet.ts:57`, `src/components/live-droplet.ts:62`, `src/components/live-droplet.ts:63`
- Live droplet fetch never follows redirects and times out after 15 s. `src/components/live-droplet.ts:65`, `src/components/live-droplet.ts:66`
- Live droplet answer that is not a `<djs-demo data-droplet="<id>">` fragment with 200, or a 500 error fragment, fails the build. `src/components/live-droplet.ts:72`, `src/components/live-droplet.ts:74`
- `LiveDroplet` props: `id`, `props`, `caption`, `toggle`. `src/components/LiveDroplet.astro:15`
- `LiveDroplet` host is the page's own URL. `src/components/LiveDroplet.astro:31`
- `LiveDroplet` loads `<DEMO_PUBLIC_URL>/index.js` as a module script. `src/components/LiveDroplet.astro:37`
- `LiveDroplet` `toggle` fetches a second render at build, hidden until its button is pressed. `src/components/LiveDroplet.astro:33`, `src/components/LiveDroplet.astro:39`
- `LiveDroplet` on `droplets:stale` replaces the element with a fresh one carrying the same `data-droplet-context`. `src/components/LiveDroplet.astro:71`, `src/components/LiveDroplet.astro:79`
- `RendererDemo` reads every file of `../demo/src/droplets/counter-*/` with `?raw`. `src/components/RendererDemo.astro:24`
- `RendererDemo` file order: the component, `+droplet.ts`, `+droplet.server.ts`, the rest. `src/components/RendererDemo.astro:39`
- `RendererDemo` throws when the droplet folder has no files. `src/components/RendererDemo.astro:50`
- `AddRenderer` uses `djs add`'s catalog and `addRenderer` config edit. `src/components/AddRenderer.astro:9`, `src/components/AddRenderer.astro:10`
- Renderer pages: each embeds `RendererDemo` with its `counter-<renderer>`. `src/content/docs/renderers/svelte.mdx:15`, `src/content/docs/renderers/vue.mdx:16`, `src/content/docs/renderers/react.mdx:16`, `src/content/docs/renderers/preact.mdx:16`, `src/content/docs/renderers/solid.mdx:15`, `src/content/docs/renderers/hono-jsx.mdx:16`, `src/content/docs/renderers/handlebars.mdx:17`, `src/content/docs/renderers/lit.mdx:16`, `src/content/docs/renderers/script.mdx:19`
- Live droplets on guide pages: `hello`, `poll`, `crash` (with `toggle`), `counter`. `src/content/docs/start/what-is-a-droplet.mdx:39`, `src/content/docs/guides/actions.mdx:263`, `src/content/docs/guides/errors.mdx:93`, `src/content/docs/guides/in-the-browser.mdx:87`
- WordPress tutorial steps: the starting point, a plugin that brings in the droplets, WordPress owns the data, the login is WordPress's, prerender at container start, run it, the result. `src/content/docs/integrate/wordpress.mdx:18`, `src/content/docs/integrate/wordpress.mdx:55`, `src/content/docs/integrate/wordpress.mdx:288`, `src/content/docs/integrate/wordpress.mdx:428`, `src/content/docs/integrate/wordpress.mdx:597`, `src/content/docs/integrate/wordpress.mdx:660`, `src/content/docs/integrate/wordpress.mdx:732`
- CSP check: every inline script the browser runs (no type, a JavaScript type or `module`) needs its sha256 in `script-src`. `scripts/csp-hashes.mjs:27`, `scripts/csp-hashes.mjs:38`
- CSP check skips data payloads such as `<script type="application/text" data-droplet-payload="data">`. `scripts/csp-hashes.mjs:29`
- CSP check fails on a missing or stale hash. `scripts/csp-hashes.mjs:44`, `scripts/csp-hashes.mjs:45`, `scripts/csp-hashes.mjs:80`
- CSP check requires the demo origin in `script-src`, `style-src`, `connect-src` and `form-action`. `scripts/csp-hashes.mjs:53`
- CSP check fails on any other unquoted source; `data:` only in `img-src` and `font-src`. `scripts/csp-hashes.mjs:54`, `scripts/csp-hashes.mjs:67`
- CSP header for every path is in `_headers`. `public/_headers:20`
- `_headers` caches `/_astro/*` and Pagefind's hashed chunks for a year, immutable. `public/_headers:29`, `public/_headers:34`, `public/_headers:36`
- `_headers` revalidates `/hosts/*` on every request. `public/_headers:41`
- CI runs `pnpm docs:build`, then `pnpm docs:check-csp`. `../../.github/workflows/ci.yml:55`, `../../.github/workflows/ci.yml:57`
- Diagram scenes: wide 620 px, narrow 360 px. `src/components/diagram-kit.ts:23`, `src/components/diagram-kit.ts:24`
- Diagram type sizes: title 15, label 14, body 13, small 12.5, code 13, code small 12.5 px, written as `font-size` attributes. `src/components/diagram-kit.ts:26`, `src/components/Diagram.astro:89`
- `Diagram` fails the build when a scene's width is not 620 or 360 px, or a scene has more than 10 nodes. `src/components/Diagram.astro:27`, `src/components/Diagram.astro:32`, `src/components/Diagram.astro:34`
- `Diagram` shows the narrow scene when its figure is under 620 px wide (a container query). `src/components/Diagram.astro:340`
- `Diagram` buttons: "Full screen" (`data-dg-open`) and "SVG" (`data-dg-svg`), hidden until the script runs. `src/components/Diagram.astro:103`, `src/components/Diagram.astro:104`
- Diagram viewer: one `<dialog>` per page, opened with `showModal()` on the scene that is on screen. `src/components/Diagram.astro:305`
- Diagram viewer zoom: 0.2 to 8 times; wheel, two-pointer pinch, one-pointer drag; keys `+`/`=`, `-`/`_`, `0` (fit), arrows (pan), `Esc`. `src/components/Diagram.astro:115`, `src/components/Diagram.astro:230`, `src/components/Diagram.astro:250`, `src/components/Diagram.astro:266`
- Diagram SVG download: `<id>.svg`, with `fill`, `stroke`, `stroke-width`, `stroke-dasharray`, `opacity` and the font properties computed and written in, on the page's `--djs-surface-100`. `src/components/Diagram.astro:118`, `src/components/Diagram.astro:164`
- `sequence()` in `diagram-kit.ts` draws the sequence figures (`FormFlow`, `WordPressFlow`). `src/components/diagram-kit.ts:191`
- Diagrams on pages: `RenderModes`, `RunsWhere`, `FormFlow`, `PrerenderLookup`, `LocationFlow`, `HostsHub`, `ShopPage`, `ShopFlow`, `WordPressFlow`, `ElementLifecycle`, `BrowserLoads`. `src/content/docs/guides/writing-droplets.mdx:74`, `src/content/docs/guides/writing-droplets.mdx:674`, `src/content/docs/guides/actions.mdx:158`, `src/content/docs/guides/prerendering.mdx:62`, `src/content/docs/integrate/http-contract.mdx:199`, `src/content/docs/integrate/hosts/overview.mdx:19`, `src/content/docs/integrate/hosts/shop-demo.mdx:23`, `src/content/docs/integrate/hosts/shop-demo.mdx:49`, `src/content/docs/integrate/wordpress.mdx:294`, `src/content/docs/guides/in-the-browser.mdx:65`, `src/content/docs/guides/deployment.mdx:344`
- Tour poster: `gen.mjs` writes `scripts/poster/tour-poster.svg`; `render.mjs` writes `public/hosts/tour.webp` in Chromium. `scripts/poster/gen.mjs:111`, `scripts/poster/render.mjs:11`, `scripts/poster/render.mjs:33`
- Tour video `public/hosts/tour.mp4` plays with `tour.webp` as its poster on the home page. `src/components/DropletTour.astro:15`, `src/content/docs/index.mdx:19`
- Worker `dropletsjs-docs` serves `./dist` as assets only, on the custom domain `dropletsjs.dev`. `wrangler.jsonc:4`, `wrangler.jsonc:8`, `wrangler.jsonc:22`
- Worker `html_handling` is `auto-trailing-slash`; unknown paths get `404.html` with 404. `wrangler.jsonc:12`, `wrangler.jsonc:14`
- Worker has no `*.workers.dev` or preview URLs. `wrangler.jsonc:17`, `wrangler.jsonc:18`
