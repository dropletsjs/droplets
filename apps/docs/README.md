# Droplets docs

The guide, built with [Astro Starlight](https://starlight.astro.build). Pages
live in `src/content/docs/`; the sidebar, in reading order, is listed in
`astro.config.mjs`: a new page goes there too.

```bash
pnpm docs:dev       # http://localhost:4321, with the demo's dev server on :5180
pnpm docs:build     # static site in apps/docs/dist, built against a local demo server
```

Link between pages with root-relative paths (`/guides/configuration/`). The
build prefixes them with the site's base path (`src/plugins/base-links.mjs`),
so the same pages work at the root of a domain and under a sub-path.

## Live droplets

Some pages embed real droplets from [apps/demo](../demo) with
`<LiveDroplet id="hello" props={{ who: "Ana" }} />`
(`src/components/LiveDroplet.astro`). The docs act as their host:

- **At build**, each one's fragment is fetched from the demo server
  (`POST /droplets/<id>` with the page as `host` and the props, and
  `x-host` set to the demo's public origin) and inlined, as a server-side
  include. A page view never asks the demo to render. `pnpm docs:build`
  runs `scripts/with-demo.mjs`: it builds apps/demo for Node, starts it on a
  free port with a DROPLETS_SECRET of its own, builds the site with
  `DEMO_URL` pointing at it, and stops it. Without a demo server the build
  fails.
- **In the browser**, the page loads `/index.js` from the demo's public
  origin (`DEMO_PUBLIC_URL`, default https://demo.dropletsjs.dev), which
  hydrates the fragments with the inline data and loads their bundles and
  stylesheets from there. The poll's enhanced form posts to the demo, and
  the `_data` refresh after it, by `fetch`: the demo answers CORS for the
  docs' origin only and lists it in `trustedOrigins`.
- **Limits.** A page only hydrates fragments of the demo build its
  `/index.js` comes from: after a demo deploy, the inlined fragments are
  stale until the docs are built again, and `LiveDroplet` swaps each for an
  element that renders in the browser from the live build (one `_data`
  request each). A vote posted without JavaScript goes to the demo and
  comes back to the page (Post/Redirect/Get), but a static page cannot
  render the result its URL carries. The crash droplet's two renders are
  both fetched at build; its button shows one or the other.

The renderer pages (`src/content/docs/renderers/`) use `RendererDemo`
(`<RendererDemo id="counter-vue" />`): the demo's `counter-<renderer>`
droplet live, next to its source files, read from `apps/demo` at build with
`?raw`. Their "Add it to a project" steps come from `AddRenderer`, which runs
`djs add`'s own catalog and config edit (`packages/droplets/src/add/`). The
Expressive Code options live in `ec.config.mjs`, not `astro.config.mjs`, so
the `<Code>` those components render gets them too.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DEMO_URL` | set by `scripts/with-demo.mjs` | Where the build fetches fragments. Set it to use a running demo instead (nothing is built or started). |
| `DEMO_PUBLIC_URL` | `https://demo.dropletsjs.dev` | Where browsers load the demo from: `/index.js`, and the `x-host` of the fragments. |

`public/_headers` allows the demo origin in `script-src`, `style-src`,
`connect-src` and `form-action`, and nowhere else; `docs:check-csp` fails
if it is missing from one of them or if any directive names another host.

## Deploying

The site at https://dropletsjs.dev is an assets-only Cloudflare Worker
(`wrangler.jsonc`): `apps/docs/dist` served as static assets on the custom
domain, with the response headers of `public/_headers` (a
Content-Security-Policy, caching). It is deployed by hand, not from CI:

The fragments must come from the demo build that is live, so deploy the
demo first ([apps/demo](../demo/README.md#deploying)), then build the docs
against it:

```bash
DEMO_URL=https://demo.dropletsjs.dev pnpm docs:build
pnpm docs:check-csp            # every inline script's hash is in _headers, the demo origin in place
cd apps/docs && npx wrangler deploy
```

`docs:check-csp` (`scripts/csp-hashes.mjs`) prints the `script-src` hashes
the build needs and fails when `_headers` misses one or lists a stale one:
after a Starlight or Astro upgrade, paste the printed set into `_headers`.
CI runs it after every docs build.

### Anywhere else

Any static host works. Two environment variables tell the build where it will
be served:

| Variable | Default | Meaning |
| --- | --- | --- |
| `DOCS_SITE` | `https://dropletsjs.dev` | The origin, for canonical links and the sitemap. |
| `DOCS_BASE` | `/` | The sub-path, when the site is not at the root of its origin. |

```bash
DOCS_SITE=https://example.github.io DOCS_BASE=/droplets pnpm docs:build
```

The output directory is `apps/docs/dist`; Node 22 or newer.
