# tests/dev-mixed

A React, Preact, Vue and Solid project (`test/fixture`, copied to
`.tmp/project`) under `vite dev`, as a user runs it: every droplet renders
on the server (200), only React's modules carry React's Fast Refresh
(Preact's compile for Preact), and on a host page of another origin, in
Chromium, every droplet hydrates without an error and an edit to each (a Vue
composable's included) reaches the page in place, with no reload.

```bash
pnpm build                                          # the packages first
pnpm --filter @dropletsjs/tests-dev-mixed test      # or: pnpm test, with everything else
```
