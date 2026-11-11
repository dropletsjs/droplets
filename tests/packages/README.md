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
