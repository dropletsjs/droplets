# wp-shop

The [shop](../shop)'s droplets with WordPress holding the data: products,
images and reviews read over WordPress's REST API (and prerendered at
start), the admin whoever is logged in to WordPress, and the writes (stock,
reviews) sent back to it. Its element is `<djs-shop>`, as the shop's.

It needs the WordPress host, [`examples/hosts/wordpress`](../hosts/wordpress):
a WordPress site whose plugin embeds the droplets with a `[droplet]`
shortcode, proxies the droplets routes and serves the REST API wp-shop reads.
The [WordPress tutorial](https://dropletsjs.dev/integrate/wordpress/) builds
it step by step.

```bash
cd examples/hosts/wordpress
docker compose up --build    # WordPress on http://localhost:8008, wp-shop beside it
pnpm test:hosts wordpress    # from the repository root: the flow in a browser
```

The environment ([`src/env.ts`](./src/env.ts), demo values in
[`.env.example`](./.env.example)): `WP_INTERNAL_URL` (how wp-shop reaches
WordPress), `WP_PUBLIC_URL` (WordPress's public origin),
`WP_SHOP_HOST_SECRET` and `WP_SHOP_SERVICE_SECRET` (shared with the plugin,
one per direction), `WP_SHOP_DATABASE` (the cart's SQLite file).

## Tests

`pnpm test:example:wp-shop` at the root runs them without WordPress: they
build and start wp-shop against a mock of WordPress's REST API
([`test/mock-wordpress.ts`](./test/mock-wordpress.ts)), including the
signed writes back and malformed answers. The real site is tested by
`pnpm test:hosts wordpress`.
