# Lit example

One droplets server, every droplet a Lit element, rendered in the custom
element `<djs-lit>`. The same three droplets exist in every example under
[`examples/frameworks`](..), so the eight differ only in the framework; this
one adds a fourth, `guestbook`, for forms in a shadow root:

| Droplet | Mode |
| ------- | ---- |
| `client` | `ssr = false`: rendered in the browser, its data fetched from `/api` |
| `ssr-hydrate` | rendered on the server with its load, then hydrated; `+error.lit.ts` is its error page |
| `ssr-nohydrate` | `hydrate = false`: server HTML and no JavaScript |
| `guestbook` | a form action, posted natively and through `enhance()` of `@dropletsjs/renderer-lit/form` |

Each of the first three extends `lib/Card.lit.ts`, a `DropletElement`, with:

- **loads**: `+droplet.server.ts` (`lib/server/facts.ts`) on the server, `+droplet.ts` on both sides, behind the props schema in `lib/props.ts`;
- **endpoints**: `src/api/*/+server.ts` (a shared counter, the time, a greeting, what the private variables tell), called through `$droplets/drop` in `lib/api.ts`;
- **the error page**: `?who=crash` makes the load throw, and `handleError` decides what `+error.lit.ts` shows;
- **env**: one variable of each kind in `src/env.ts`, with demo values in `.env`;
- **hooks**: `src/hooks.server.ts` puts a request id in `event.locals`.

Each element renders into a declarative shadow root, so its styles are
`static styles` in the class (`cardStyles`), not a stylesheet: `src/app.css`
reaches the light DOM only, and themes the cards through a custom property,
`--card-accent`.

```bash
pnpm --filter @dropletsjs/example-lit dev               # http://localhost:5173: the devtools page
pnpm --filter @dropletsjs/example-lit build             # dist/server.js for Node
pnpm --filter @dropletsjs/example-lit build:cloudflare  # dist/worker.js for Workers (wrangler.jsonc)
pnpm --filter @dropletsjs/example-lit start             # http://localhost:8000
```

Then `http://localhost:8000/droplets/ssr-hydrate?who=Ana` is the fragment a
host pastes into its page. [`tests/examples`](../../../tests/examples) checks
all eight examples in a browser, embedded from another origin, and this one
further in `e2e/lit.spec.ts`.
