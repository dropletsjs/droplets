# tests/create-droplets

`npm create droplets`, end to end, as a user runs it without a terminal:
each framework alone, all eight with every adapter and Tailwind, and a pair
with the dev tool and Claude. Then what a user does next: `djs sync`, a type
check, a build, and the built server answering for every starter droplet.
The flags' errors (no folder, no frameworks, a taken folder) are checked too.

The projects are written to `.tmp/` (gitignored), inside the workspace, so
they resolve the workspace's packages instead of installing from npm.

```bash
pnpm build                                              # the packages first
pnpm --filter @dropletsjs/tests-create-droplets test    # or: pnpm test, with everything else
```
