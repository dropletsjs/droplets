---
title: Contributing
description: "Where the contributing guide lives, and the commands to start with."
---

The contributing guide is `CONTRIBUTING.md` at the root of the repository:
the layout, the checks, what a pull request needs, how releases are versioned
and how this site is built. It is the one copy; this page only points there.

To start:

```bash
pnpm install
pnpm build          # compile every package into dist/
pnpm dev            # the Svelte example (examples/frameworks/svelte) with hot updates
pnpm check          # build, typecheck, test, build every example for Node and Workers
pnpm docs:dev       # this site, on http://localhost:4321
```
