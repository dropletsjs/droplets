# Examples

Every example here is a droplets server or a page that embeds one. The
framework examples, the shop and wp-shop are workspace packages: `pnpm
install` and `pnpm build` at the root, then `pnpm --filter <name> dev`. The
hosts are standalone, each with its own toolchain, run with Docker Compose.

## [`frameworks/`](./frameworks)

One example per framework, each the same three droplets, so they differ only
in the framework: `client` (rendered in the browser), `ssr-hydrate`
(server-rendered, then hydrated, with an error page) and `ssr-nohydrate`
(server HTML, no JavaScript), with server and universal loads, a props
schema, `/api` endpoints, env variables of each kind and a `handle` hook.

| Example | Package | Element |
| ------- | ------- | ------- |
| [`svelte`](./frameworks/svelte) | `@dropletsjs/example-svelte` | `<djs-svelte>` |
| [`vue`](./frameworks/vue) | `@dropletsjs/example-vue` | `<djs-vue>` |
| [`react`](./frameworks/react) | `@dropletsjs/example-react` | `<djs-react>` |
| [`preact`](./frameworks/preact) | `@dropletsjs/example-preact` | `<djs-preact>` |
| [`solid`](./frameworks/solid) | `@dropletsjs/example-solid` | `<djs-solid>` |
| [`hono-jsx`](./frameworks/hono-jsx) | `@dropletsjs/example-hono-jsx` | `<djs-hono-jsx>` |
| [`handlebars`](./frameworks/handlebars) | `@dropletsjs/example-handlebars` | `<djs-handlebars>` |
| [`lit`](./frameworks/lit) | `@dropletsjs/example-lit` | `<djs-lit>` |

The Lit one adds a fourth droplet, `guestbook`, with a form action posted
from inside a shadow root.

`pnpm dev` at the root runs the Svelte one; `pnpm build:examples` builds all
eight for Node and `pnpm build:examples:cloudflare` for Workers;
[`tests/examples`](../tests/examples) checks them in a browser.
[`frameworks/Dockerfile`](./frameworks/Dockerfile) builds any of them into an
image (`--build-arg EXAMPLE=vue`); the hosts use the Svelte one.

## [`shop/`](./shop)

A demo shop in six frameworks on SQLite: nine droplets (a product library, a
filter, a product card and page, comments, a cart, a login, an admin, toasts), form
actions that work without JavaScript, cookies, uploads. Its element is
`<djs-shop>`; [`CONTRACT.md`](./shop/CONTRACT.md) says what a host passes
each droplet. `pnpm dev:shop` at the root.

## [`wp-shop/`](./wp-shop)

The shop's droplets with WordPress holding the data: products and reviews
read over the REST API and prerendered at start, the admin whoever is logged
in to WordPress. It runs next to the WordPress host
([`hosts/wordpress`](./hosts/wordpress)).

## [`hosts/`](./hosts)

The host examples, listed in [`hosts/hosts.json`](./hosts/hosts.json) by
language. Each is a Docker Compose project that starts the shop (and, for
most, the Svelte example's server) next to the host: the shop's pages on
`/gallery`, the Svelte example's three droplets on `/` where there is one.
Not in the pnpm workspace. The folder name is the host's id everywhere: its
docs page, its recordings and `pnpm test:hosts <id>`.
[`hosts/README.md`](./hosts/README.md) has the patterns, the ports and the
end-to-end recordings ([`tests/hosts`](../tests/hosts)).

<!-- hosts:table -->
| Host | Language | Pattern |
| ---- | -------- | ------- |
| [`express`](./hosts/express) | JavaScript / TypeScript | Fragment fetch in a route handler, or the droplets server mounted inside Express |
| [`nextjs`](./hosts/nextjs) | JavaScript / TypeScript | Fragment fetch in a server component |
| [`sveltekit`](./hosts/sveltekit) | JavaScript / TypeScript | Fragment fetch in `+page.server.ts`, `{@html}` in the page |
| [`astro`](./hosts/astro) | JavaScript / TypeScript | Fragment fetch in the frontmatter, `set:html` |
| [`react-vite`](./hosts/react-vite) | JavaScript / TypeScript | A client-side `<Droplet>` component, the shop through a same-origin proxy |
| [`fastapi`](./hosts/fastapi) | Python | Fragment fetch with `httpx`, pasted into a Jinja2 template |
| [`php`](./hosts/php) | PHP | Fragment fetch with `curl_multi`, pasted into plain PHP templates |
| [`wordpress`](./hosts/wordpress) | PHP | A `[droplet]` shortcode plugin serving `examples/wp-shop` |
| [`sinatra`](./hosts/sinatra) | Ruby | Fragment fetch with `Net::HTTP`, pasted into ERB |
| [`nginx`](./hosts/nginx) | No backend code | Server Side Includes and a reverse proxy, same origin |
| [`htmx`](./hosts/htmx) | No backend code | `hx-get` swaps the fragments in, proxied or cross-origin; `hx-boost` swaps `<main>` alone |
| [`static`](./hosts/static) | No backend code | The page fetches the fragments from the shop's own origin, cross-origin; no cookies, so no cart or admin |
<!-- /hosts:table -->
