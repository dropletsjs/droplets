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

`test/production.test.ts` builds the same project with `vite build` (copied
to `.tmp/production`) and checks that nothing of the above is in it: none of
a list of dev markers (HMR event names, `import.meta.hot`, the notices, the
dev tool's hooks, dev-only warnings, Fast Refresh and Prefresh globals) in
any emitted JavaScript, no `update` export in a droplet's client module, and
no code of a dev module (`dev-element`, `dev-notify`, `dev-contract`,
`client-dev`, the devtools) in any chunk, nor a file of one in `dist/`.

```bash
pnpm build                                          # the packages first
pnpm --filter @dropletsjs/tests-dev-mixed test      # or: pnpm test, with everything else
```
