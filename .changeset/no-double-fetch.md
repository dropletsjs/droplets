---
"@dropletsjs/droplets": patch
---

A droplet no longer runs `+droplet.ts`'s `load` twice. The server sends `load`'s result in the fragment as `data-droplet-payload="data"` and the element hydrates the component with it, without running `load` in the browser. This is a breaking change: `load` no longer runs in the browser at hydrate. It still runs there on a refresh (after an enhanced form's answer), on a client-only mount (`ssr = false`, `?noSSR`) and on the fallback through `_data`. `render: { rerunLoad: true }` in `droplets.config.ts` restores the old behaviour. A value outside `true` and `false` fails the build with the new error `render-rerun-load-not-boolean`. See "Where `load` runs" in Configuration.

`load`'s result now follows the payload contract when it goes into the HTML: plain JSON plus the transported values (`Date`, `Map`, `Set`, `URL`, `BigInt` and your `transport` entries). A value the contract refuses renders `+error`, as a failed load does. A droplet without `+droplet.ts`'s `load` sends exactly what it sent before.

When the server did not run `load` (`ssr = false`, `?noSSR`, `rerunLoad` true), the fragment carries the server data as `data-droplet-payload="server"` instead, and the element decodes it and runs `load` on it. A fragment never carries more than one of the two. A prerendered render keeps both, and the page gets the one its request needs.

`rendererConformance()` now requires the load counter: `hello`'s `+droplet.ts` pushes `data.who` to `globalThis.conformanceLoads` when the list exists. A renderer's own suite fails until its fixture adds it (the layout is in `conformance.ts`).
