# Handlebars example

One droplets server, every droplet in Handlebars, rendered in the custom element
`<djs-handlebars>`. The same three droplets exist in every example under
[`examples/frameworks`](..), so the eight differ only in the framework:

| Droplet | Mode |
| ------- | ---- |
| `client` | `ssr = false`: rendered in the browser, its data fetched from `/api` |
| `ssr-hydrate` | rendered on the server with its load, then hydrated; `+error.hbs` is its error page |
| `ssr-nohydrate` | `hydrate = false`: server HTML and no JavaScript |

Each shows the `card` partial (`partials/card.hbs`) and `lib/card-data.ts`, with:

- **loads**: `+droplet.server.ts` (`lib/server/facts.ts`) on the server, `+droplet.ts` on both sides, behind the props schema in `lib/props.ts`;
- **endpoints**: `src/api/*/+server.ts` (a shared counter, the time, a greeting, what the private variables tell), which the other examples call from the browser and a host can call too;
- **the error page**: `?who=crash` makes the load throw, and `handleError` decides what `+error.hbs` shows;
- **env**: one variable of each kind in `src/env.ts`, with demo values in `.env`;
- **hooks**: `src/hooks.server.ts` puts a request id in `event.locals`.

Templates have no client behaviour: `client` renders in the browser from
`_data`, and none of the three has a +1 button. The counter shows what the
load saw.

```bash
pnpm --filter @dropletsjs/example-handlebars dev               # http://localhost:5173: the devtools page
pnpm --filter @dropletsjs/example-handlebars build             # dist/server.js for Node
pnpm --filter @dropletsjs/example-handlebars build:cloudflare  # dist/worker.js for Workers (wrangler.jsonc)
pnpm --filter @dropletsjs/example-handlebars start             # http://localhost:8000
```

Then `http://localhost:8000/droplets/ssr-hydrate?who=Ana` is the fragment a
host pastes into its page. [`tests/examples`](../../../tests/examples) checks
all eight examples in a browser, embedded from another origin.
