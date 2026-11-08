# tests/djs-add

`djs add`, end to end, on a Svelte project (`test/fixture`, copied to
`.tmp/project`): a droplet in every framework (the seven others are added to
the Vite config and tsconfig on the way) and every target (`full`, `ssr`,
`client`, `ssg`), with and without the optional files (server and universal
loads, the error page, styles). Then a type check, a build, and the built
server answering for each droplet.

```bash
pnpm build                                        # the packages first
pnpm --filter @dropletsjs/tests-djs-add test      # or: pnpm test, with everything else
```
