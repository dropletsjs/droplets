`examples/shop`: the demo shop, one standalone droplets server on SQLite that the host examples embed.

## Rules

- The shop is standalone: users copy it, so it depends only on published `@dropletsjs/*` packages (`workspace:*` here) and public tools, never on `@dropletsjs/shared` or a `../../` path. Only `Dockerfile` builds from the repository root, against the workspace packages.
  Checked by: `package.json`.
- The shop builds for Node only: SQLite through better-sqlite3, images on disk.
- `CONTRACT.md` is the contract for hosts: a change to a droplet's props, a window event, the JSON API or the headers a host passes changes it too, and every host that runs the shop.
  Checked by: `../../tests/hosts/e2e/shop.spec.ts` (`pnpm test:hosts`).
- `product-comments` props are `productId`, `order` (`oldest` or `newest`), `page` and `showing` (10, 20, 25 or 50; default 10); only `oldest` pages already full at build are prerendered.
  Checked by: `test/unit.test.ts` ("the comments entries rule").
- Authorization lives in data: a fragment without a session renders the login gate, an admin action answers `fail(401)`; `handle` never redirects.
  Checked by: `test/server.test.ts`.
- Form actions work without JavaScript (Post/Redirect/Get, signed with `DROPLETS_SECRET`) and enhanced.
  Checked by: `test/server.test.ts` ("without JavaScript").
- Endpoints take plain data: `FormData` or `JSON.parse`, fields read through `Object.hasOwn`, every body under a size limit, `__proto__` stays data.
  Checked by: `test/server.test.ts`.
- The admin session is an HMAC-signed cookie, verified in constant time before it is read; credentials are compared in constant time.
  Checked by: `test/unit.test.ts` ("the admin session").
- No secret is committed or baked into an image: `.env.example` holds demo values only.
- A droplet uses one framework; framework-specific shared components live in `src/lib/svelte/` and `src/lib/vue/`, the rest of `src/lib/` is framework-agnostic.
  Checked by: the plugin, in `vite build` and `vite dev`.
- `*.server.*` and `src/lib/server/` never reach a client bundle.
  Checked by: the plugin, in `vite build` and `vite dev`.
- The tests run against the built server: `pnpm build`, then `pnpm test`.
  Checked by: `pnpm test:example:shop` in `pnpm check`.
- A behaviour change comes with a test; a fix with a test that failed before it.
- Comments explain a non-obvious why.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).
