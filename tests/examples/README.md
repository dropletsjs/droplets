# tests/examples

The eight examples in [`examples/frameworks`](../../examples/frameworks), end to
end in Chromium, against their production builds. Playwright starts each
example's droplets server (8400 and up) and one host page on another origin
(`e2e/host.mjs`, :8100) that fetches the fragments on the server and loads
`/index.js`, as a real host does. One project per example, the same checks
for each: the three modes, the variables where they belong (and the secret
nowhere), hydration, the shared counter through `/api`, the props schema,
the error page, and droplets the host writes itself. The Svelte project also
checks its script droplet, `page-views` (`/svelte/script` embeds it twice).

The `lit` project also runs `e2e/lit.spec.ts`: the declarative shadow roots
in the server markup, hydration that keeps every node, a fragment inserted
with `innerHTML` (its shadow root attached by the renderer), the guestbook's
form action from inside a shadow root, the error page and a click replayed
after `hydrate = "interactive"`. `e2e/host.mjs` serves `/<example>/inserted`
and `/<example>/one/<droplet>` for it.

```bash
pnpm test:e2e                                   # build the examples, then run every project
pnpm --filter @dropletsjs/tests-examples e2e --project vue   # one example (built already)
```

The first run needs Chromium: `pnpm --filter @dropletsjs/tests-examples exec playwright install chromium`.
