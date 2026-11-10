# htmx

Two static pages whose droplets htmx swaps in. A droplets server answers
`GET /droplets/<id>` with an HTML fragment, which is what htmx asks a server
for; `/index.js`, loaded once, makes every droplet element live, including
the ones htmx puts in later. No server renders these pages.

```bash
docker compose up --build
open http://localhost:8010
```

| Page | What it shows |
| ---- | ------------- |
| `/` (`html/index.html`) | The Svelte example's three droplets, from its own origin (`:8000`, cross-origin): one on `load`, one on a click, one once `revealed`. |
| `/shop` (`html/shop.html`) | The shop's droplets through nginx's proxy (same origin), in a body with `hx-boost`: the product page's enhanced form, the login's plain form (Post/Redirect/Get) and a product card asked for once revealed. |

What it needs, in short (the docs' [htmx page](https://dropletsjs.dev/integrate/hosts/htmx/)
has the details):

- **Cross-origin**: `<meta name="htmx-config" content='{"selfRequestsOnly": false}'>`
  for htmx, and `cors` on the droplets server (the Svelte example has
  `cors: true`), which answers the preflight htmx's `HX-*` headers cause.
- **`hx-boost`**: `hx-boost="false"` on each element that receives a
  droplet, so the droplet's forms stay its own; and the same `<head>` on
  every page, since a boosted link swaps only the `<body>`.

htmx is `htmx.org` from npm, pinned in `package.json` and
`package-lock.json`; the `Dockerfile` installs it and copies
`dist/htmx.min.js` into the image. The pages are written for the default
ports; nginx rewrites the droplets server's URL in them when
`DROPLETS_URL` says otherwise (`sub_filter`).

End to end: `pnpm test:hosts htmx`, from the repository root
(`tests/hosts/e2e/htmx.spec.ts`).
