# tests

A package's own tests live in its `test/` folder (`packages/droplets/test/`,
`packages/renderers/svelte/test/`, …) and run with `pnpm test`. This folder
holds the end-to-end tests that cross packages: each `tests/<what>/` builds
or starts real projects and checks them from outside, in a browser or a
shell. [`examples`](./examples) (the framework examples), [`hosts`](./hosts)
(every host stack, with Docker), [`create-droplets`](./create-droplets),
[`djs-add`](./djs-add) and [`dev-mixed`](./dev-mixed) (`vite dev` with
several renderers).
