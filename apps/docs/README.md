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
2. Writing droplets (Writing droplets, Styling, Shared libraries (import
   maps), Actions, Prerendering, Errors, Server code, Development,
   Configuration)
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
  (`POST /droplets/<id>` with the page as `host` and the props) and inlined,
  as a server-side include. The demo's build fixes its `location`, so the
  URLs a fragment writes are on `https://demo.dropletsjs.dev` wherever the
  server runs. A page view never asks the demo to render.
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
| `DEMO_PUBLIC_URL` | `https://demo.dropletsjs.dev` | Where browsers load the demo from: `/index.js`, and the Examples box's fragments and pages. The fragments' own URLs come from the demo's fixed `location`, so a built site keeps this default. |

`pnpm docs:dev --port 4400` passes the port to the demo's dev server as
`DOCS_PORT`, so the demo trusts that origin too.

### The Examples box

Writing droplets shows the same testimonials list rendered by the demo's
five `testimonials-*` droplets, one per flag combination
(`src/components/DropletExamples.astro`). Vertical tabs on the left, one per
droplet with its flags and what they do, the render space on the right; at
phone width the tabs stack above it and only the open one keeps its text.
A tab fetches its droplet's fragment from the demo when it first opens
(`GET <DEMO_PUBLIC_URL>/droplets/<id>`) and inserts it through a
`<template>`; the prerendered tab's pager fetches
`/assets/prerendered/testimonials-prerender-only/page-<n>`, the files the
demo's build writes from its prerender entries (under `astro dev`, the live
route: the demo's dev server has no such files). At build each fragment is fetched once, so a droplet the demo
does not render fails the build.

The console below it lists what the page asks the demo for: `window.fetch`
wrapped on this page (the fragments, the API, `_data`) and a
`PerformanceObserver` for the modules and stylesheets from the demo origin.
A server load's `event.fetch` runs on the demo server and never shows there.

### CSP

`public/_headers` holds the site's Content-Security-Policy. `script-src`
lists the sha256 of each inline script Starlight writes; the docs' own
component scripts are always bundled to files under `/_astro/`, never
inlined (`assetsInlineLimit` in `astro.config.mjs`), so editing a component
never changes the hashes. The demo origin is allowed in `script-src`,
`style-src`, `connect-src` and `form-action`, and nowhere else; Cloudflare
Web Analytics' beacon (`https://static.cloudflareinsights.com/beacon.min.js/`)
in `script-src` alone.

`docs:check-csp` (`scripts/csp-hashes.mjs`) prints the `script-src` hashes
the build needs and fails when `_headers` misses one or lists a stale one,
when the demo origin is missing from one of those four directives or the
beacon from `script-src`, or when any directive names another source. After a Starlight or Astro upgrade, paste
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
| `HostsHub` | Hosts |
| `ShopPage`, `ShopFlow` | Shop demo |
| `WordPressFlow` | WordPress, step 3 |
| `ElementLifecycle` | In the browser, What happens on connect |
| `BrowserLoads` | Deployment, Behind a proxy |

`DropletAnatomy` (an interactive explorer of the fragment) and
`DropletTour` (the home page's video) are not diagrams and keep their own
markup.

### Markdown twins

Every page is also a Markdown file for agents: `/guides/configuration/` has
`/guides/configuration.md`, the home page `/index.md`
(`src/plugins/markdown-twin.mjs`). They are not rendered on their own: after
the build, `src/plugins/llms-txt.mjs` splits the finished `llms-full.txt` into
its pages and writes each one, so a twin is cleaned exactly as `llms-full.txt`
is (no live droplets, heading anchors or images, each diagram as its
description). `llms.txt` links every page to its twin, every page's head names
it in `<link rel="alternate" type="text/markdown">` (`src/route-data.ts`, a
Starlight route middleware), and `_headers` keeps the twins out of search
results with `X-Robots-Tag: noindex`.

Under each page's title, and under the home page's hero, "Copy as Markdown"
puts the twin on the clipboard and "View as Markdown" opens it
(`PageActions.astro`, shown by the `PageTitle` and `Hero` overrides). The
build fails when a page lacks its twin or its alternate link.

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

### Share image and robots.txt

Every page's head carries `og:image` and `twitter:image`, the absolute URL
of `public/og.png` on `DOCS_SITE` and `DOCS_BASE`, with its width, height and
alt text (`head` in `astro.config.mjs`). The image is drawn, not
screenshotted from the site: `scripts/og/render.mjs` lays out the title and
the `ogImage` text of `site.mjs` (whose title and description
`astro.config.mjs` reads) in the dark tokens and the docs' fonts, and writes
the 1200×630 PNG in Playwright's Chromium. Its text is its own, so a shorter
site description leaves the image as it is. Run it again after changing that
text:

```bash
node apps/docs/scripts/og/render.mjs
```

The home page names itself in full: its frontmatter `head` sets `<title>`,
`og:title` and `twitter:title` to "Droplets: server-rendered components for
any stack"; every other page keeps Starlight's "Page | Droplets".

`public/robots.txt` allows every crawler and names the sitemap
Starlight writes, `https://dropletsjs.dev/sitemap-index.xml`; a build for
another origin needs its own.

### Deploying

The site is an assets-only Cloudflare Worker (`wrangler.jsonc`):
`apps/docs/dist` served as static assets on the custom domain, with the
response headers of `public/_headers`. CI deploys it on every push to
`main`, right after the demo (`deploy-docs` in `.github/workflows/ci.yml`,
`needs: deploy-demo`), in the GitHub environment `cloudflare`, with the
commands below. They work by hand too, with a Wrangler login or
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set.

The fragments must come from the demo build that is live, so deploy the demo
first ([apps/demo](../demo/README.md#deploying)), then build the docs against
it. From a clean checkout, `pnpm install --frozen-lockfile` and `pnpm build`
come first; with `DEMO_URL` set, `with-demo.mjs` builds nothing of the demo
but runs its `djs sync`, since the pages read the demo's sources:

```bash
DEMO_URL=https://demo.dropletsjs.dev pnpm docs:build
pnpm docs:check-csp
pnpm --filter @dropletsjs/docs deploy:cloudflare   # wrangler deploy of apps/docs/dist
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

- `pnpm docs:dev` runs `node scripts/errors.mjs`, then `node scripts/dev.mjs`, in this package. `../../package.json:21`, `package.json:8`
- `pnpm docs:build` runs `node scripts/errors.mjs`, then `node scripts/with-demo.mjs astro build`. `../../package.json:22`, `package.json:9`
- `pnpm docs:check-csp` runs `scripts/csp-hashes.mjs`. `../../package.json:24`
- Docs `typecheck` is `astro check`. `package.json:13`
- Docs `deploy:cloudflare` runs `wrangler deploy` (the declared `wrangler` dev dependency) and builds nothing. `package.json:11`
- CI job `deploy-docs` runs `pnpm build:dist`, `pnpm docs:build` with `DEMO_URL=https://demo.dropletsjs.dev`, `pnpm docs:check-csp`, then `pnpm --filter @dropletsjs/docs deploy:cloudflare`. `../../.github/workflows/ci.yml:312`, `../../.github/workflows/ci.yml:335`, `../../.github/workflows/ci.yml:336`, `../../.github/workflows/ci.yml:337`
- `deploy-docs` needs `deploy-demo` and the four other CI jobs, and runs only on a push to `main` of `dropletsjs/droplets`. `../../.github/workflows/ci.yml:292`, `../../.github/workflows/ci.yml:293`
- `deploy-docs` runs in the GitHub environment `cloudflare`, with no dependency cache; the Cloudflare credentials reach the deploy step only. `../../.github/workflows/ci.yml:296`, `../../.github/workflows/ci.yml:339`, `../../.github/workflows/ci.yml:340`
- Node version: the repository requires Node 22 or newer. `../../package.json:9`
- Content collection: Starlight's `docsLoader()`, which reads `src/content/docs/` only. `src/content.config.ts:6`
- Sidebar order is the `sidebar` constant, passed to Starlight; the "Next" links, the sections of `llms.txt` and the page order of `llms-full.txt` follow it. `astro.config.mjs:50`, `astro.config.mjs:156`, `astro.config.mjs:131`, `astro.config.mjs:167`
- Sidebar groups, in order: Start here, Writing droplets, Renderers, Integrating, In the browser, Deployment, Security, Reference. `astro.config.mjs:52`, `astro.config.mjs:56`, `astro.config.mjs:70`, `astro.config.mjs:86`, `astro.config.mjs:99`, `astro.config.mjs:100`, `astro.config.mjs:101`, `astro.config.mjs:103`
- Sidebar Renderers group: Overview, Svelte, Vue, React, Preact, Solid, Hono JSX, Handlebars, Lit, plain script; collapsed. `astro.config.mjs:70`, `astro.config.mjs:71`
- Sidebar Integrating group: any stack, a client-only page, HTTP contract, Hosts (collapsed: Overview, one group per language from `examples/hosts/hosts.json` with a page per built host, WordPress a link to its tutorial, then the shop demo), WordPress. `astro.config.mjs:31`, `astro.config.mjs:86`, `astro.config.mjs:92`, `astro.config.mjs:96`
- `DOCS_SITE` defaults to `https://dropletsjs.dev`, `DOCS_BASE` to `/`. `astro.config.mjs:13`, `astro.config.mjs:14`
- `trailingSlash` is `"always"`. `astro.config.mjs:121`
- Component scripts of `src/components/*.astro` are never inlined (`assetsInlineLimit` returns `false` for them). `astro.config.mjs:24`, `astro.config.mjs:27`
- `vite` stays external at prerender time, for `AddRenderer`'s `parseAst`. `astro.config.mjs:126`
- Sidebar Start here group: what is a droplet, ways to use Droplets, getting started, manual setup. `astro.config.mjs:52`
- Sidebar Writing droplets group: writing droplets, styling, shared libraries (import maps), actions, prerendering, errors, server code, development, configuration. `astro.config.mjs:56`
- `starlight-llms-txt` writes `/llms.txt`, `/llms-full.txt`, `/llms-small.txt` and the sets `/_llms-txt/renderers.txt` and `/_llms-txt/known-hosts.txt` at build, pages in sidebar order (`promote`). `astro.config.mjs:165`, `astro.config.mjs:167`, `astro.config.mjs:173`
- `src/plugins/llms-txt.mjs` (`llmsTxt`) rewrites those files after the build (`astro:build:done`), then checks them. `astro.config.mjs:130`, `src/plugins/llms-txt.mjs:58`
- `llms.txt`: the title, the home page's hero tagline as the summary, `llmsDetails` (what Droplets is, its essentials and the Markdown twins), the documentation sets, one section per sidebar group with each page's title, the absolute URL of its Markdown twin and its `description`, then the optional links. `src/plugins/llms-txt.mjs:22`, `src/plugins/llms-txt.mjs:115`, `src/plugins/llms-txt.mjs:238`, `src/plugins/llms-txt.mjs:258`
- In `llms-full.txt`, `llms-small.txt` and the sets, every page starts with its title, `Source: <its URL>` and its description. `src/plugins/llms-txt.mjs:156`
- In those files, root-relative and `#` links are absolute on `DOCS_SITE` and `DOCS_BASE`, table cells carry no padding, no two blank lines follow each other (code included) and a heading with nothing under it is dropped. `src/plugins/llms-txt.mjs:145`, `src/plugins/llms-txt.mjs:180`, `src/plugins/llms-txt.mjs:215`, `src/plugins/llms-txt.mjs:229`
- The pages are told apart by `LLMS_PAGE_BREAK`, the plugin's `pageSeparator`; the outputs separate them by a blank line. `src/plugins/llms-txt.mjs:19`, `astro.config.mjs:168`
- `llms-*.txt` leave out the section "A note from the author" of `start/what-is-a-droplet` (`omit`). `astro.config.mjs:133`, `src/plugins/llms-txt.mjs:204`
- `llms-small.txt` leaves out the renderer pages but the overview, the known hosts and the WordPress tutorial (`exclude`), and notes and tips (the plugin's default); it keeps its lines and the `<details>` (`minify`). Its `<SYSTEM>` line names the pages it leaves out. `astro.config.mjs:170`, `astro.config.mjs:172`, `src/plugins/llms-txt.mjs:97`
- `llms-*.txt` leave out the live droplets (`.live-droplet`), the Examples box (`.droplet-examples`), the heading anchor links (`.sl-anchor-link`), every `img`, the tour video (`.droplet-tour`), the host recordings and screenshots (`.host-demo`), the host gallery (`.host-grid`), the fragment anatomy's mock-up and hint (`.ax-mock`, `.ax-hint`), the diagram figures (`.dg`) and a page's sentences about what is on screen (`.screen-only`, the lead-ins of `hello` and the Examples box). `astro.config.mjs:205`
- A diagram rendered for `llms-*.txt` (its page's URL ends in `.txt`) writes `**Diagram: <title>.** <desc>` in place of the figure. `src/components/Diagram.astro:41`, `src/components/Diagram.astro:52`
- The docs build fails when a page is not in the sidebar, two pages share a title, `llms.txt` lacks a sidebar page, an `omit` heading is gone, or a line outside code in `llms-full.txt`, `llms-small.txt` or a set has a link without a scheme, an image, or "Full screen", "Download as SVG", "Section titled" or "Hover, focus or tap". `src/plugins/llms-txt.mjs:65`, `src/plugins/llms-txt.mjs:78`, `src/plugins/llms-txt.mjs:286`, `src/plugins/llms-txt.mjs:38`
- Base links: after the build, root-relative `<a href>` get the `base` prefix; nothing changes when `base` is `/`. `src/plugins/base-links.mjs:23`, `src/plugins/base-links.mjs:24`
- Expressive Code options live in `ec.config.mjs` (themes `github-dark`, `github-light`). `ec.config.mjs:12`
- `docs:dev` starts the demo's dev server (`pnpm run dev` in `../demo`) with `DOCS_PORT`. `scripts/dev.mjs:37`
- `docs:dev` `DOCS_PORT` is the `--port` passed to astro dev, else 4321. `scripts/dev.mjs:17`
- `docs:dev` waits up to 30 s for `http://localhost:5180/health` before starting astro dev. `scripts/dev.mjs:12`, `scripts/dev.mjs:40`
- `docs:dev` runs astro dev with `DEMO_URL` and `DEMO_PUBLIC_URL` both `http://localhost:5180`. `scripts/dev.mjs:54`
- `docs:dev` stops both servers when either exits. `scripts/dev.mjs:30`
- `with-demo.mjs` with `DEMO_URL` already set builds and starts nothing: it runs the demo's `djs sync` (the pages read the demo's sources, whose tsconfig extends `.droplets/tsconfig.json`), then the command against it. `scripts/with-demo.mjs:48`, `scripts/with-demo.mjs:49`
- `with-demo.mjs` fails unless `packages/droplets/dist/vite.js` exists, with or without `DEMO_URL`: run `pnpm build` first. `scripts/with-demo.mjs:44`
- `with-demo.mjs` builds the demo with `DROPLETS_ADAPTER=node`. `scripts/with-demo.mjs:59`
- `with-demo.mjs` starts the demo's `dist/server.js` on a free `127.0.0.1` port. `scripts/with-demo.mjs:66`, `scripts/with-demo.mjs:73`
- `with-demo.mjs` demo env: `PORT` and a random 32-byte `DROPLETS_SECRET`; nothing about the location, which the demo's build fixes. `scripts/with-demo.mjs:77`, `scripts/with-demo.mjs:80`, `../demo/droplets.config.ts:29`
- `with-demo.mjs` waits up to 20 s for the demo's `/health`; a demo that exits or never answers fails the run. `scripts/with-demo.mjs:93`, `scripts/with-demo.mjs:95`
- `with-demo.mjs` runs the command with `DEMO_URL` and `DEMO_PUBLIC_URL`, stops the demo, and prints its log on failure. `scripts/with-demo.mjs:107`, `scripts/with-demo.mjs:109`
- `DEMO_PUBLIC_URL` defaults to `https://demo.dropletsjs.dev`. `src/components/live-droplet.ts:19`, `scripts/with-demo.mjs:55`
- `DEMO_URL` unset: a page with a live droplet throws at build. `src/components/live-droplet.ts:39`
- `DEMO_URL` and `DEMO_PUBLIC_URL` must be `http(s)` URLs. `src/components/live-droplet.ts:29`
- Live droplet element: the demo renders in `<djs-demo>`. `src/components/live-droplet.ts:17`
- Live droplet fetch: `POST <DEMO_URL>/droplets/<id>`, JSON `{ host, props }`, `accept: text/html`, no location header. `src/components/live-droplet.ts:62`, `src/components/live-droplet.ts:63`, `src/components/live-droplet.ts:64`
- Live droplet fetch never follows redirects and times out after 15 s. `src/components/live-droplet.ts:66`, `src/components/live-droplet.ts:67`
- Live droplet answer that is not a `<djs-demo data-droplet="<id>">` fragment with 200, or a 500 error fragment, fails the build. `src/components/live-droplet.ts:73`, `src/components/live-droplet.ts:75`
- Live droplet build error names the body's length, its first and last 300 characters, and the answer's `content-type`, `content-length`, `content-encoding`, `cache-control`, `cf-ray` and `server-timing`. `src/components/live-droplet.ts:76`, `src/components/live-droplet.ts:81`, `src/components/live-droplet.ts:84`
- `LiveDroplet` props: `id`, `props`, `caption`, `toggle`. `src/components/LiveDroplet.astro:15`
- `LiveDroplet` host is the page's own URL. `src/components/LiveDroplet.astro:31`
- `LiveDroplet` loads `<DEMO_PUBLIC_URL>/index.js` as a module script. `src/components/LiveDroplet.astro:37`
- `LiveDroplet` `toggle` fetches a second render at build, hidden until its button is pressed. `src/components/LiveDroplet.astro:33`, `src/components/LiveDroplet.astro:39`
- `LiveDroplet` on `droplets:stale` replaces the element with a fresh one carrying the same `data-droplet-context`. `src/components/LiveDroplet.astro:71`, `src/components/LiveDroplet.astro:79`
- `DropletExamples` tabs: `testimonials-client-only`, `-server-client`, `-server-only`, `-prerender-only`, `-none`; each fetched once at build through `fetchFragment`. `src/components/DropletExamples.astro:19`, `src/components/DropletExamples.astro:56`
- `DropletExamples` loads `<DEMO_PUBLIC_URL>/index.js` as a module script. `src/components/DropletExamples.astro:65`
- `DropletExamples` fetches a tab's fragment when it first opens (the first one when the box comes within 300 px of the viewport) and inserts it through a `<template>`. `src/components/DropletExamples.astro:228`, `src/components/DropletExamples.astro:249`, `src/components/DropletExamples.astro:285`
- `DropletExamples` pager pages: `<DEMO_PUBLIC_URL>/assets/prerendered/testimonials-prerender-only/page-<n>`, the live route under `astro dev`. `src/components/DropletExamples.astro:59`
- `DropletExamples` console: `window.fetch` wrapped for requests to the demo origin, a `PerformanceObserver` for its other resources, 60 lines at most. `src/components/DropletExamples.astro:153`, `src/components/DropletExamples.astro:190`, `src/components/DropletExamples.astro:207`
- `DropletExamples` stacks the tabs above the render space under 38rem of column. `src/components/DropletExamples.astro:327`, `src/components/DropletExamples.astro:389`
- `RendererDemo` reads every file of `../demo/src/droplets/counter-*/` with `?raw`. `src/components/RendererDemo.astro:24`
- `RendererDemo` file order: the component, `+droplet.ts`, `+droplet.server.ts`, the rest. `src/components/RendererDemo.astro:39`
- `RendererDemo` throws when the droplet folder has no files. `src/components/RendererDemo.astro:50`
- `AddRenderer` uses `djs add`'s catalog and `addRenderer` config edit. `src/components/AddRenderer.astro:12`, `src/components/AddRenderer.astro:13`
- Renderer pages: each embeds `RendererDemo` with its `counter-<renderer>`. `src/content/docs/renderers/svelte.mdx:15`, `src/content/docs/renderers/vue.mdx:16`, `src/content/docs/renderers/react.mdx:16`, `src/content/docs/renderers/preact.mdx:16`, `src/content/docs/renderers/solid.mdx:15`, `src/content/docs/renderers/hono-jsx.mdx:16`, `src/content/docs/renderers/handlebars.mdx:17`, `src/content/docs/renderers/lit.mdx:16`, `src/content/docs/renderers/script.mdx:19`
- Live droplets on guide pages: `hello` (twice: what a droplet is, and Styling for theming from the page's `--djs-*` properties), `poll`, `crash` (with `toggle`), `counter`. `src/content/docs/start/what-is-a-droplet.mdx:40`, `src/content/docs/guides/styling.mdx:219`, `src/content/docs/guides/actions.mdx:196`, `src/content/docs/guides/errors.mdx:93`, `src/content/docs/guides/in-the-browser.mdx:87`
- WordPress tutorial steps: the starting point, a plugin that brings in the droplets, WordPress owns the data, the login is WordPress's, prerender at container start, run it, the result. `src/content/docs/integrate/wordpress.mdx:18`, `src/content/docs/integrate/wordpress.mdx:55`, `src/content/docs/integrate/wordpress.mdx:298`, `src/content/docs/integrate/wordpress.mdx:438`, `src/content/docs/integrate/wordpress.mdx:633`, `src/content/docs/integrate/wordpress.mdx:697`, `src/content/docs/integrate/wordpress.mdx:774`
- CSP check: every inline script the browser runs (no type, a JavaScript type or `module`) needs its sha256 in `script-src`. `scripts/csp-hashes.mjs:28`, `scripts/csp-hashes.mjs:39`
- CSP check skips data payloads such as `<script type="application/text" data-droplet-payload="data">`. `scripts/csp-hashes.mjs:30`
- CSP check fails on a missing or stale hash. `scripts/csp-hashes.mjs:45`, `scripts/csp-hashes.mjs:46`, `scripts/csp-hashes.mjs:88`
- CSP check requires the demo origin in `script-src`, `style-src`, `connect-src` and `form-action`. `scripts/csp-hashes.mjs:57`
- CSP check requires `https://static.cloudflareinsights.com/beacon.min.js/` in `script-src`, and nowhere else. `scripts/csp-hashes.mjs:55`, `scripts/csp-hashes.mjs:58`
- `script-src` allows Cloudflare's Web Analytics beacon because Web Analytics is set to auto-install on the dropletsjs.dev zone, with EU visitors excluded and demo.dropletsjs.dev excluded by a Configuration Rule; the beacon reports to `/cdn-cgi/rum` on the docs' origin, under `connect-src 'self'`. `public/_headers:15`, `public/_headers:24`
- CSP check fails on any other unquoted source; `data:` only in `img-src` and `font-src`. `scripts/csp-hashes.mjs:79`, `scripts/csp-hashes.mjs:80`
- CSP header for every path is in `_headers`. `public/_headers:24`
- `_headers` caches `/_astro/*` and Pagefind's hashed chunks for a year, immutable. `public/_headers:33`, `public/_headers:38`, `public/_headers:40`
- `_headers` revalidates `/hosts/*` on every request. `public/_headers:45`
- `_headers` sends `X-Robots-Tag: noindex` on `/*.md`; Wrangler uploads `.md` files as `text/markdown; charset=utf-8`, so no `Content-Type` rule. `public/_headers:50`
- CI runs `pnpm docs:build`, then `pnpm docs:check-csp`. `../../.github/workflows/ci.yml:118`, `../../.github/workflows/ci.yml:121`
- Diagram scenes: wide 620 px, narrow 360 px. `src/components/diagram-kit.ts:23`, `src/components/diagram-kit.ts:24`
- Diagram type sizes: title 15, label 14, body 13, small 12.5, code 13, code small 12.5 px, written as `font-size` attributes. `src/components/diagram-kit.ts:26`, `src/components/Diagram.astro:101`
- `Diagram` fails the build when a scene's width is not 620 or 360 px, or a scene has more than 10 nodes. `src/components/Diagram.astro:27`, `src/components/Diagram.astro:32`, `src/components/Diagram.astro:34`
- `Diagram` shows the narrow scene when its figure is under 620 px wide (a container query). `src/components/Diagram.astro:352`
- `Diagram` buttons: "Full screen" (`data-dg-open`) and "SVG" (`data-dg-svg`), hidden until the script runs. `src/components/Diagram.astro:115`, `src/components/Diagram.astro:116`
- Diagram viewer: one `<dialog>` per page, opened with `showModal()` on the scene that is on screen. `src/components/Diagram.astro:317`
- Diagram viewer zoom: 0.2 to 8 times; wheel, two-pointer pinch, one-pointer drag; keys `+`/`=`, `-`/`_`, `0` (fit), arrows (pan), `Esc`. `src/components/Diagram.astro:127`, `src/components/Diagram.astro:242`, `src/components/Diagram.astro:262`, `src/components/Diagram.astro:278`
- Diagram SVG download: `<id>.svg`, with `fill`, `stroke`, `stroke-width`, `stroke-dasharray`, `opacity` and the font properties computed and written in, on the page's `--djs-surface-100`. `src/components/Diagram.astro:130`, `src/components/Diagram.astro:176`
- `sequence()` in `diagram-kit.ts` draws the sequence figures (`FormFlow`, `WordPressFlow`). `src/components/diagram-kit.ts:191`
- Diagrams on pages: `RenderModes`, `RunsWhere`, `FormFlow`, `PrerenderLookup`, `LocationFlow`, `HostsHub`, `ShopPage`, `ShopFlow`, `WordPressFlow`, `ElementLifecycle`, `BrowserLoads`. `src/content/docs/guides/writing-droplets.mdx:79`, `src/content/docs/guides/writing-droplets.mdx:499`, `src/content/docs/guides/actions.mdx:157`, `src/content/docs/guides/prerendering.mdx:225`, `src/content/docs/integrate/http-contract.mdx:231`, `src/content/docs/integrate/hosts/overview.mdx:29`, `src/content/docs/integrate/hosts/shop-demo.mdx:27`, `src/content/docs/integrate/hosts/shop-demo.mdx:53`, `src/content/docs/integrate/wordpress.mdx:304`, `src/content/docs/guides/in-the-browser.mdx:65`, `src/content/docs/guides/deployment.mdx:381`
- Tour poster: `gen.mjs` writes `scripts/poster/tour-poster.svg`; `render.mjs` writes `public/hosts/tour.webp` in Chromium. `scripts/poster/gen.mjs:111`, `scripts/poster/render.mjs:11`, `scripts/poster/render.mjs:33`
- Tour video `public/hosts/tour.mp4` plays with `tour.webp` as its poster on the home page. `src/components/DropletTour.astro:15`, `src/content/docs/index.mdx:61`
- Site title and description (103 characters, whole in link previews) live in `site.mjs`, read by `astro.config.mjs`; `scripts/og/render.mjs` reads the title and the `ogImage` text. `site.mjs:3`, `site.mjs:6`, `site.mjs:11`, `astro.config.mjs:6`, `scripts/og/render.mjs:10`
- Home page `<title>`, `og:title` and `twitter:title`: "Droplets: server-rendered components for any stack", from its frontmatter `head`. `src/content/docs/index.mdx:6`
- Every page's head: `og:image` and `twitter:image` (absolute, `<DOCS_SITE><DOCS_BASE>og.png`), `og:image:width` 1200, `og:image:height` 630, `og:image:alt` and `twitter:image:alt`; Starlight writes `twitter:card` `summary_large_image`. `astro.config.mjs:17`, `astro.config.mjs:142`, `site.mjs:10`
- Share image: `scripts/og/render.mjs` writes `public/og.png`, 1200×630, in Chromium, the drop taken from `public/favicon.svg`. `scripts/og/render.mjs:16`, `scripts/og/render.mjs:18`, `scripts/og/render.mjs:51`
- `public/robots.txt`: `User-agent: *`, `Allow: /`, `Sitemap: https://dropletsjs.dev/sitemap-index.xml`. `public/robots.txt:1`
- Worker `dropletsjs-docs` serves `./dist` as assets only, on the custom domain `dropletsjs.dev`. `wrangler.jsonc:4`, `wrangler.jsonc:8`, `wrangler.jsonc:22`
- Worker `html_handling` is `auto-trailing-slash`; unknown paths get `404.html` with 404. `wrangler.jsonc:12`, `wrangler.jsonc:14`
- Worker has no `*.workers.dev` or preview URLs. `wrangler.jsonc:17`, `wrangler.jsonc:18`
- Markdown twin: every page's Markdown is `/<slug>.md` (`/guides/configuration.md`), the home page's `/index.md`, on `DOCS_BASE`. `src/plugins/markdown-twin.mjs:9`, `src/plugins/markdown-twin.mjs:16`
- Markdown twins are written after the build from the finished pages of `llms-full.txt`, one file each: the same text, cleaned the same way (title, `Source:` URL, summary; no live droplets, heading anchors or images; diagrams as their description; `omit` applied). `src/plugins/llms-txt.mjs:83`, `src/plugins/llms-txt.mjs:105`
- Markdown twins go through the same checks as `llms-full.txt` (absolute links, no image, no UI text). `src/plugins/llms-txt.mjs:119`, `src/plugins/llms-txt.mjs:286`
- Every page's head has `<link rel="alternate" type="text/markdown" href="<DOCS_BASE><slug>.md">`, added by the route middleware; Starlight's 404 page has none. `astro.config.mjs:158`, `src/route-data.ts:7`
- The docs build fails when a built page (`<slug>/index.html`, `404.html` aside) has no Markdown twin, or not exactly one alternate link naming it, or a twin has no page. `src/plugins/llms-txt.mjs:124`, `src/plugins/llms-txt.mjs:324`
- Page actions: "Copy as Markdown" (a button) and "View as Markdown" (a link to the twin) under every page's title, and under the home page's hero; none on 404. `src/components/PageActions.astro:15`, `src/components/PageTitle.astro:7`, `src/components/Hero.astro:8`, `astro.config.mjs:160`, `astro.config.mjs:161`
- "Copy as Markdown" fetches the twin and writes it with a `ClipboardItem` holding the fetch's promise (Safari keeps the click's activation), `writeText` where `ClipboardItem` is missing; the result goes to a `role="status"` region and the button's label for 2 s. `src/components/PageActions.astro:46`, `src/components/PageActions.astro:48`, `src/components/PageActions.astro:30`, `src/components/PageActions.astro:36`
- The copy button takes its place hidden (`visibility`) until its script runs, and its three labels share one grid cell, so nothing moves. `src/components/PageActions.astro:110`, `src/components/PageActions.astro:121`
- The page actions are left out of the search index (`data-pagefind-ignore`) and their script is bundled to `/_astro/`, so the CSP hashes do not change. `src/components/PageActions.astro:15`, `astro.config.mjs:27`
