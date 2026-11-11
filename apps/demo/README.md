# Demo droplets

The droplets the docs embed live, served at https://demo.dropletsjs.dev. One
server, every renderer, rendered in `<djs-demo>`:

| Droplet | Framework | Shows |
| --- | --- | --- |
| `hello` | Svelte | a server `load` that greets `who` from the props; rendered on the server, then hydrated |
| `counter` | React | interactivity after hydration; no server load, so the browser fetches only its bundle |
| `poll` | Vue | a form action, enhanced: `?/vote` checks the answer, `fail()`s with a code, echoes the vote. Stateless: nothing is stored, counted or shared between visitors |
| `crash` | Solid | `?fail=1` (or `{ "fail": true }`) makes the load throw; `handleError` and `+error.tsx` render inside the same element |
| `counter-svelte`, `counter-vue`, `counter-react`, `counter-preact`, `counter-solid`, `counter-hono-jsx`, `counter-lit` | one each | the renderer pages' droplet, the same in each: a server load returns `{ framework, start: 3 }`, the server renders it, the browser hydrates it and a button adds one |
| `counter-handlebars` | Handlebars | the same card, server HTML only (`hydrate = false`): a template has no code in the browser |
| `counter-script` | plain script | the same counter built in the browser from the load's data; the server sends an empty element |

The renderer pages show the counters' source files as they are here
(`apps/docs/src/components/RendererDemo.astro` reads them at build), so an
edit here changes the page.

```bash
pnpm --filter @dropletsjs/demo dev                # http://localhost:5180, the devtools page
pnpm --filter @dropletsjs/demo build              # dist/server.js for Node
pnpm --filter @dropletsjs/demo start              # http://localhost:8790
pnpm --filter @dropletsjs/demo build:cloudflare   # dist/worker.js for the Worker
pnpm --filter @dropletsjs/demo test               # needs the Node build; builds the Worker itself
```

`pnpm docs:dev` at the root runs this dev server next to the docs, and
`pnpm docs:build` builds and starts the Node server to fetch the fragments
it inlines ([apps/docs/README.md](../docs/README.md)).

## Who may embed it

`droplets.config.ts` allows exactly the docs' origins
(`src/lib/origins.ts`: https://dropletsjs.dev and the docs' local dev server
on port 4321), for CORS and for form posts (`trustedOrigins`). Every other
origin gets no CORS answer and a `403` for a form post. `pnpm docs:dev --port
4400` starts this dev server with `DOCS_PORT=4400`, which adds that port's
`localhost` and `127.0.0.1` origins; nothing else sets it.

The poll's action reads one field as a string of at most ten characters and
looks it up in a `Map`; the framework resolves the droplet and the action
before the body is read, and the bodies are limited to a few kilobytes.
`test/server.test.ts` has a negative test for each of these.

## Secrets

`DROPLETS_SECRET` signs the result of a vote posted without JavaScript
(Post/Redirect/Get). It is never committed:

- locally, `pnpm dev` writes a random one to `.env.local` (gitignored) the
  first time, and `pnpm start` reads it from there;
- the docs build generates one per run for the server it starts;
- the Worker reads it from a Worker secret: `wrangler secret put DROPLETS_SECRET`.

## Deploying

The Worker `dropletsjs-demo` on the custom domain `demo.dropletsjs.dev`
(`wrangler.jsonc`), deployed by hand, never from CI:

```bash
pnpm --filter @dropletsjs/demo build:cloudflare
cd apps/demo
npx wrangler secret put DROPLETS_SECRET   # once: openssl rand -base64 32
npx wrangler deploy
```

`run_worker_first` lists only `/index.js` and `/droplets/*`: the two kinds
of paths that are also files in `dist/client` but must be answered by the
Worker. Everything else under `dist/client`, `/assets/*` above all, is
served as a static asset without invoking the Worker, with the headers of
`public/_headers` (CORS for https://dropletsjs.dev, cached for a year). A
path that is no file (`/health`, `/droplets.json`, which `.assetsignore`
keeps out of the upload) still reaches the Worker. `test/worker.test.ts`
runs the Worker build under `wrangler dev` with this config and checks that
nothing server-only is reachable.

Every build has a new build hash, and a page only hydrates fragments of the
build its `/index.js` comes from. The docs inline fragments at their build,
so after a demo deploy, build and deploy the docs against it
([apps/docs/README.md](../docs/README.md#deploying)).
