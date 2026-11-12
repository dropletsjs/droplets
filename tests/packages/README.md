# tests/packages

The published packages as `npm pack` writes them, checked against each
package's `tsdown.config.ts` (its entries, copies and `graphCheck` lists).
It covers every package tsdown builds: all but `create-droplets`, which is a
Vite build.

```bash
pnpm build                                        # the packages' dist/ first
pnpm --filter @dropletsjs/tests-packages test     # this suite
pnpm test:integration                             # every tests/* suite
```

## Details

### What it needs

- Every package built: `npm pack` runs with `--ignore-scripts`, so it packs
  whatever `dist/` holds (`pnpm build`, or `pnpm build:dist` to skip the
  unit tests).
- `npm` and `tar` on the `PATH`.

### What it checks, per package

Each package is packed into a temporary folder (`droplets-packed-*` under
the OS temp dir, removed afterwards) and unpacked:

- every file `exports` and `bin` point at is there, and every relative
  import of a `bin` launcher;
- every tsdown `entry` is at `dist/<entry>.js` with its `dist/<entry>.d.ts`,
  since the code finds these by path;
- every `copy` file (an as-is component, such as `.svelte`) is byte for byte
  its source;
- from each `graphCheck` client entry, following relative imports through
  the shared chunks, no file is a server path (`*.server.*`, `+server.*`, a
  `server/` folder) or a server entry, and none imports `node:*`;
- `dist/` imports only the package itself, its `dependencies`, its
  `peerDependencies`, `node:*`, `virtual:*` and `$droplets/*`;
- `import.meta.env.DEV` and `import.meta.hot` survive the minifier when the
  sources use them, and no `{ DEV: true|false }` or `import.meta.env =`
  replaces them, so the consumer's Vite decides;
- no source maps, no reference to `tsconfig.base` or `@dropletsjs/config`,
  the `.d.ts` keep JSDoc, and no JavaScript or `.d.ts` imports a `.css` file;
- `@dropletsjs/droplets` only: `dist/runtime/entry-client.js` and the one
  `dist/chunks/dev-element-*.js` each keep one `/* @vite-ignore */` dynamic
  import.

### The examples' ranges

`test/examples.test.ts` reads every `package.json` under `examples/`
(`shop`, `wp-shop`, `frameworks/*`, `hosts/*`, skipping installed and built
folders) and checks that no range is `workspace:` or `catalog:`, that every
`@dropletsjs/*` dependency is `^<that package's version>` as `packages/`
declares it, and, for the workspace examples, that every tool of the pnpm
catalog (`@dropletsjs/shared/catalog`) is at the catalog's literal range.
The hosts bring their own toolchains, so only their `@dropletsjs/*` ranges
are checked.

### The attribute scan

`test/attributes.test.ts` reads the sources, not the tarballs: every
`data-*` name the runtime, the renderers and the devtools read or write (a
string, a template, a JSX attribute, a `dataset` access) must be
`data-droplet` or `data-droplet-*`. `SCANNED` lists the folders, `KEY_FILES`
the files the scan must reach.

### The workflows

`test/workflows.test.ts` reads every `.github/workflows/*.yml` line by line
(no YAML parser in the suite's dependencies): the top-level `on` names only
`pull_request` and `push`, and every `runs-on` is a GitHub-hosted label
(`ubuntu-*`, `macos-*`, `windows-*`). A form of `on` it cannot read fails
the suite, and a `runs-on` list or expression fails the label check.

### Changing it

A new published package built by tsdown goes into `PACKAGES`. A new entry
or a renamed server module changes the package's `tsdown.config.ts`; this
suite reads it from there.

## Facts

- `PACKAGES` lists the packed packages: droplets, devtools, four adapters, eight renderers. `test/packed.test.ts:20`
- `create-droplets` is not in `PACKAGES`: its build is `vite build`, not tsdown. `test/packed.test.ts:20`, `../../packages/create-droplets/package.json:35`
- Packing runs `npm pack --json --ignore-scripts --pack-destination <dir>` in the package folder. `test/packed.test.ts:107`
- Packed tarball is unpacked with `tar -xzf --strip-components=1`. `test/packed.test.ts:113`
- Packed packages live in a `droplets-packed-*` temp dir, removed after the suite. `test/packed.test.ts:91`
- `tsdown.config.ts` is imported for its `entry`, `copy` and the `droplets:graph-check` plugin's `client`/`server` lists. `test/packed.test.ts:53`
- Source maps: no `.map` file ships. `test/packed.test.ts:118`
- Workspace-only config: no packed file but `package.json` mentions `tsconfig.base` or `@dropletsjs/config`. `test/packed.test.ts:123`
- `exports` and `bin` targets exist; a `bin` launcher's relative imports exist. `test/packed.test.ts:129`
- Fixed paths: every tsdown entry ships as `dist/<entry>.js` and `dist/<entry>.d.ts`. `test/packed.test.ts:140`
- As-is `copy` files ship unchanged from `src/`. `test/packed.test.ts:147`
- Client entries reach no server path, no server entry and no `node:*` import, through relative imports. `test/packed.test.ts:153`
- Server path: a file named `*.server.*` or `+server.*`, or under a `server/` folder. `../../packages/shared/tsdown.ts:51`
- As-is components (not `.js`) are not followed: the consumer compiles them. `test/packed.test.ts:166`
- Declared deps: `dist/` imports only the package name, `dependencies`, `peerDependencies`, `node:*`, `virtual:*`, `$droplets/*`. `test/packed.test.ts:175`
- Relative imports in `dist/` must resolve to a packed file. `test/packed.test.ts:185`
- `import.meta.env.DEV` and `import.meta.hot` stay literal in `dist/` when the sources use them. `test/packed.test.ts:193`
- `import.meta.env.DEV` is never replaced: no `import.meta.env =` or `{ DEV: true|false }` in `dist/`. `test/packed.test.ts:207`
- `.d.ts` files exist and keep JSDoc. `test/packed.test.ts:210`
- CSS imports: no `.css` specifier in any `dist/*.js` or `.d.ts`. `test/packed.test.ts:214`
- `@vite-ignore`: `dist/runtime/entry-client.js` and the single `dist/chunks/dev-element-*.js` keep one each. `test/packed.test.ts:222`
- Test and hook timeout 120 s, one `npm pack` per package. `vitest.config.ts:7`
- Test script is `vitest run`. `package.json:9`
- Examples' ranges: `shop`, `wp-shop`, every `frameworks/*` and every `hosts/*` folder, each `package.json` under it outside installed and built folders. `test/examples.test.ts:21`, `test/examples.test.ts:48`
- Examples' ranges: no `workspace:` or `catalog:` range in any example, hosts included. `test/examples.test.ts:60`
- Examples' ranges: every `@dropletsjs/*` dependency is `^<the package's version>` from `packages/`, hosts included. `test/examples.test.ts:70`
- Examples' ranges: in the workspace examples every tool of the pnpm catalog is at the catalog's literal range; the hosts' toolchains are their own. `test/examples.test.ts:84`
- `test/attributes.test.ts` scans the sources under `SCANNED` (the runtime, every renderer's `src/`, the devtools' `src/`) for `data-*` names in strings, templates, JSX attributes and `dataset` accesses, and fails on any that is not `data-droplet` or `data-droplet-*`. `test/attributes.test.ts:21`, `test/attributes.test.ts:58`
- `KEY_FILES` names the files the attribute scan must reach, so a moved folder fails the suite. `test/attributes.test.ts:37`
- Workflows: every `.github/workflows/*.yml` has a top-level `on` naming only `pull_request` and `push`. `test/workflows.test.ts:17`, `test/workflows.test.ts:26`
- Workflows: every `runs-on` matches `ubuntu-*`, `macos-*` or `windows-*`; a list or an expression fails. `test/workflows.test.ts:18`, `test/workflows.test.ts:59`
- Workflows are read line by line; an `on` form the reader does not know throws. `test/workflows.test.ts:26`
