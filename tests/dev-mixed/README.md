# tests/dev-mixed

Every renderer in one project (React, Preact, Vue, Solid, Svelte, Lit, Hono
JSX, Handlebars and a script droplet, in `test/fixture`, copied to
`.tmp/project`) under `vite dev`, as a user runs it. Every droplet renders on
the server (200), and only React's modules carry React's Fast Refresh (only
Preact's carry Prefresh). On a host page of another origin, in Chromium,
every droplet hydrates without an error. Then `dev.strategy: "hmr"`, with a
marker on `window` that a reload would lose:

- A component edit keeps the count in React, Preact and Vue, a Vue
  composable's edit included. Svelte and Solid swap in place with their own
  HMR, and their count starts over. Lit and Hono JSX remount in place.
  Handlebars swaps its markup. A script droplet runs its cleanup, then its
  function again on the same element.
- A load edit brings new data and keeps the count: the server load for
  React, Preact, Vue, Solid, Lit and Hono JSX, and the universal load for
  Svelte.
- A new render contract: `hydrate` false → true hydrates live. Every other
  change shows the right notice (status, or alert dialog with Reload page),
  in core's toast or in the dev tool.
- `index.js?strategy=remount` still remounts.

```bash
pnpm build                                          # the packages first
pnpm --filter @dropletsjs/tests-dev-mixed test      # or: pnpm test, with everything else
```
