---
title: Ways to use Droplets
description: "The shapes a Droplets project takes: fragments pasted in by a host's server, droplets loaded from the browser, prerendered renders, a droplets server on its own, and several frameworks in one project. What the host does in each."
---

A droplets server is one build of your `src/droplets/` folder, running on
Node, Bun, Deno or Cloudflare Workers. It answers a few HTTP routes: the
droplet as an HTML fragment (`/droplets/<id>`), its data as JSON
(`/droplets/<id>/_data`), one module that defines the custom element
(`/index.js`) and the build's files (`/assets/*`). What changes from one
project to the next is who asks for those routes and when. These are the
shapes the code supports; a project can use several at once.

## Fragments pasted in by the host's server

The host renders its page on its own server (PHP, Rails, Django, Express,
WordPress, Next.js, anything that speaks HTTP). For each droplet it fetches
the fragment, pastes it into the page, and adds the one script tag:

```html
<!-- the host's template -->
<main>
  <?= $fragment ?>  <!-- GET http://droplets:8000/droplets/greeting?who=Ana -->
</main>
<script type="module" src="https://drops.example.com/index.js"></script>
```

The page arrives with the droplet's HTML already in it, so it shows before
any JavaScript runs. In the browser, the element hydrates the markup from the
data the fragment carries inline, without a second request; a droplet with
`hydrate = false` loads no bundle of its own and stays the server's HTML.

What the host does:

- fetches `GET /droplets/<id>?prop=value`, or `POST /droplets/<id>` with a
  JSON body `{ "props": { … } }` for props that do not fit in a query string;
- tells the droplets server which public URL the browser uses for it, either
  with `x-droplet-location` on each fetch (trusted only for the server's own
  origin and the `trustedOrigins` / `DROPLETS_TRUSTED_ORIGINS` entries) or
  once at build with `location` in `droplets.config.ts`;
- loads `/index.js` once per page, from that same location;
- either serves the droplets routes under its own origin through a proxy
  (`/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*`, `/api/*`: no CORS, cookies are
  first-party), or lets the browser reach the droplets server on another
  origin, which then needs `cors` in its config.

[Any other stack](/integrate/any-stack/) has the exact headers and the
security checklist, the [HTTP contract](/integrate/http-contract/) every
route, and [Known hosts](/integrate/hosts/overview/) one worked example per
stack.

## Loaded from the browser

The host has no server of its own, or does not want to wait for one: a
single-page app, a static HTML page, an htmx page. The browser asks the
droplets server directly, in one of two ways:

- **It fetches the fragment** (`fetch`, `hx-get`) and inserts it into the
  DOM. The markup and the inline data arrive together; the element upgrades
  on insert and hydrates.
- **It writes the element itself**, with the droplet id and its props as
  attributes. The element mounts the component in the browser and requests
  `_data` when the droplet has a server load.

```html
<script type="module" src="https://drops.example.com/index.js"></script>
<djs-droplet data-droplet="greeting" data-params='{"who":"Ana"}'></djs-droplet>
```

What the host does: loads `/index.js` from the droplets server, and either
inserts fragments or writes elements. A droplets server on another origin
needs `cors`. [A client-only page](/integrate/client-only/) walks through it
with a React app, and the [htmx host](/integrate/hosts/htmx/) swaps fragments
in with `hx-get`.

## Prerendered at build

A droplet with `prerender = true` in its component and an `entries`
function in `+droplet.server.ts` is rendered at `vite build` for each props
set `entries` returns. The droplets server then answers those props from the
stored render, without running the load or the component, and renders any
other props live, as it would without prerendering.

```ts
// src/droplets/product-page/+droplet.server.ts
export const entries = async () => (await allSlugs()).map((slug) => ({ props: { slug } }));
```

What the host does: nothing different. It fetches the same fragment from the
same URL, in any of the shapes on this page; only the server's work behind
it changes. A render that needs the page it is embedded in reads `host`,
which an entry can name, or `host` in `droplets.config.ts` fixes for every
render. [Prerendering](/guides/prerendering/) has the details.

## A droplets server on its own

The droplets server can also be the page. In production and under
`vite preview`, `/` serves the `index` page: the file `index` in
`droplets.config.ts` names, else `index.html` in the project root, else a
small placeholder (`index: false` answers `404`). That file is served as
written, so it is a plain HTML page that loads `/index.js` and writes the
droplet elements; on the same origin it needs no CORS and no
`x-droplet-location`.

A built Node server can also run inside another Node server: importing
`dist/server.js` does not listen, and its default export is `{ fetch }`, a
`Request => Promise<Response>` handler, so an Express app mounts it on
its own origin and renders fragments in-process with
`droplets.fetch(new Request(url))`, with no HTTP round trip. Under `vite dev`,
`/` belongs to the devtools page when `@dropletsjs/devtools` is installed.
[Deployment](/guides/deployment/) covers both, and the
[Express host](/integrate/hosts/express/) runs the second one.

## Several frameworks in one project

The renderers you list in `vite.config.ts` work side by side: a
`+droplet.svelte`, a `+droplet.vue` and a `+droplet.tsx` can live in the same
`src/droplets/`, build into one server and render on one page. Each droplet
uses one framework, and so does everything it imports apart from
framework-neutral code; the build refuses a droplet that reaches another
framework's files or packages, naming the import chain.

What the host does: nothing different. Every droplet, whatever its
framework, is the same element and the same routes, and the page loads one
`/index.js` for all of them; each droplet's bundle carries only its own
framework. [Renderers](/renderers/) has the rules for shared extensions
such as `.tsx`, and the shop example puts six frameworks in one project.

## Several servers on one page

A page can embed droplets from more than one droplets server. Each server
names its element with `element` in `droplets.config.ts` (`djs-droplet` by
default), and each element loads from where its own server's `/index.js`
came from, so give every server a distinct `element`. See
[In the browser](/guides/in-the-browser/).
