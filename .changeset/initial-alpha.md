---
"@dropletsjs/droplets": major
"@dropletsjs/devtools": major
"@dropletsjs/adapter-node": major
"@dropletsjs/adapter-cloudflare": major
"@dropletsjs/adapter-bun": major
"@dropletsjs/adapter-deno": major
"@dropletsjs/renderer-svelte": major
"@dropletsjs/renderer-vue": major
"@dropletsjs/renderer-react": major
"@dropletsjs/renderer-preact": major
"@dropletsjs/renderer-solid": major
"@dropletsjs/renderer-hono-jsx": major
"@dropletsjs/renderer-handlebars": major
"@dropletsjs/renderer-lit": major
"create-droplets": major
---

Initial alpha release.

Droplets are server-rendered components any page can embed, from any stack,
over plain HTTP: a fragment at `GET /droplets/<id>`, one `/index.js` that
defines the droplet element, and each droplet's own bundle.

- `@dropletsjs/droplets`: the core, a Vite plugin on Hono. Droplets in
  `src/droplets/<id>/` with server and universal loads, a props schema,
  `+server.ts` endpoints, `handle` hooks, error pages, form actions, typed
  env variables, scoped styles (Tailwind optional), selective hydration and
  generated `./$types`; `djs sync` and `djs add`. Script droplets: a
  `+droplet.script.ts` (or `.js`) instead of a component, plain browser code
  whose default export runs with `(data, el)` and may return a cleanup;
  built in, typed with `DropletScript<Data>`, the server never imports it. Prerendered renders are
  kept off every public path: in `dist/server/_prerendered/` on Node, Bun
  and Deno, and on Workers in an assets directory named anew every build
  that only the Worker knows, with `.assetsignore` keeping `droplets.json`
  and `.vite/` from being uploaded.
- Adapters: `@dropletsjs/adapter-node`, `-cloudflare`, `-bun` and
  `-deno`, each deciding what `vite build` emits.
- Renderers: `@dropletsjs/renderer-svelte`, `-vue`, `-react`,
  `-preact`, `-solid`, `-hono-jsx`, `-handlebars` and `-lit`, several of
  them in one project if you like. React, Preact, Solid and Hono JSX share
  `.tsx`: a component names its own by what it imports or by a
  `@jsxImportSource` comment, and each renderer compiles only the modules
  its droplets reach. Lit droplets (`+droplet.lit.ts`) render into a
  declarative shadow root with `@lit-labs/ssr` and hydrate in place, on
  Workers too; a form in a shadow root finds its droplet, and a replayed
  click reaches the node clicked inside one.
- `@dropletsjs/devtools`: a page in `vite dev` to pick a droplet,
  edit its props and see how it renders.
- `create-droplets`: `npm create droplets@alpha` writes a typed, building
  project for the frameworks and adapters you pick.
