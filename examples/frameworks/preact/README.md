# Preact example

One droplets server, every droplet in Preact, rendered in the custom element
`<djs-preact>`. The same three droplets exist in every example under
[`examples/frameworks`](..), so the eight differ only in the framework:

| Droplet | Mode |
| ------- | ---- |
| `client` | `ssr = false`: rendered in the browser, its data fetched from `/api` |
| `ssr-hydrate` | rendered on the server with its load, then hydrated; `+error.tsx` is its error page |
| `ssr-nohydrate` | `hydrate = false`: server HTML and no JavaScript |

Each shows `lib/Card.tsx`, with:

- **loads**: `+droplet.server.ts` (`lib/server/facts.ts`) on the server, `+droplet.ts` on both sides, behind the props schema in `lib/props.ts`;
- **endpoints**: `src/api/*/+server.ts` (a shared counter, the time, a greeting, what the private variables tell), called through `$droplets/drop` in `lib/api.ts`;
- **the error page**: `?who=crash` makes the load throw, and `handleError` decides what `+error.tsx` shows;
- **env**: one variable of each kind in `src/env.ts`, with demo values in `.env`;
- **hooks**: `src/hooks.server.ts` puts a request id in `event.locals`.

```bash
pnpm --filter @dropletsjs/example-preact dev               # http://localhost:5173: the devtools page
pnpm --filter @dropletsjs/example-preact build             # dist/server.js for Node
pnpm --filter @dropletsjs/example-preact build:cloudflare  # dist/worker.js for Workers (wrangler.jsonc)
pnpm --filter @dropletsjs/example-preact start             # http://localhost:8000
```

Then `http://localhost:8000/droplets/ssr-hydrate?who=Ana` is the fragment a
host pastes into its page. [`tests/examples`](../../../tests/examples) checks
all eight examples in a browser, embedded from another origin.
