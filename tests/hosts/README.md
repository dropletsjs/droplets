# tests/hosts

The shop demo on every host in [`examples/hosts`](../../examples/hosts), end
to end: for each host, its compose stack is started (`docker compose up
--build -d`), the same flow runs in Chromium (the gallery, a product into the
cart, the admin login, that product's stock set to 0, the product page
saying "Out of stock", and a post without JavaScript), and the stack is
taken down. Each run is recorded (`recordings/`, gitignored).

The WordPress showcase has a flow of its own (`e2e/shop-wordpress.spec.ts`):
a comment posted on a product page, the cart, then WordPress's login,
wp-admin's Shop screen for the stock, a logout, and the cart and product
page as an anonymous visitor; with the negative cases for the Shop screen.
Its tour (`--tour`) posts a comment too.

The htmx host ([`examples/hosts/htmx`](../../examples/hosts/htmx)) serves
no shop pages, so it has its own flow too (`e2e/htmx.spec.ts`), run only
by name: droplets swapped in on load, on a click and once revealed, from
another origin; the shop's enhanced and plain forms under `hx-boost`; a
boosted link and the browser's Back.

```bash
pnpm test:hosts                     # all nine, one at a time (wordpress only by name)
pnpm test:hosts express nginx       # some
pnpm test:hosts wordpress           # the WordPress showcase, with wp-shop
pnpm test:hosts htmx                # the htmx pages
pnpm test:hosts express --https     # express behind Caddy, Secure cookies off localhost
pnpm test:hosts --docs              # also refresh the docs' videos and screenshots (needs ffmpeg)
HOSTS_PORT_BASE=18000 pnpm test:hosts   # every published port moved into 18000-18099
```

`run.mjs` lists every flag. Each stack is the compose project
`droplets-<host>`, on whatever Docker the environment points at, and is
removed with `down -v` after its run. The repository's `.env.local`, when
there is one, is read first (variables already set win;
[`.env.example`](../../.env.example) lists them). Docker and Playwright's
Chromium are all it needs.
