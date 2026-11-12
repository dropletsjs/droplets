# @dropletsjs/shared

What more than one package, app or test in this repository uses: the tsdown
build config and its two plugins, the base tsconfig, the Vitest presets and
the `.env.local` loader. It is private and never published; the workspace
imports it by package name.

```ts
// packages/<name>/tsdown.config.ts
import { defineConfig } from "tsdown";
import { base, graphCheck } from "@dropletsjs/shared/tsdown";

export default defineConfig({
  ...base,
  entry: ["./src/index.ts", "./src/client.ts"],
  plugins: [graphCheck({ client: ["client"] })],
});
```

```json
{ "extends": "@dropletsjs/shared/tsconfig.base.json" }
```

## Details

### Exports

| Import | What it holds |
|---|---|
| `@dropletsjs/shared/tsdown` | `base`, `bareImport`, `cssInline()`, `graphCheck()`, `isServerPath()`, `GraphCheckOptions` |
| `@dropletsjs/shared/tsconfig.base.json` (also `./tsconfig`) | the compiler options every workspace project extends |
| `@dropletsjs/shared/vitest` | `rendererTests`, `adapterTests`, `happyDom`, `FIXTURE_ROOT`, `buildFixtureApp()`, `freePort()`, `onFreePort()`, `listensOn()`, `fromBuild()`, `waitForServer()`, `stopServer()` |
| `@dropletsjs/shared/env` | `loadEnvLocal()` |
| `@dropletsjs/shared/catalog` | `catalogRanges()`, `workspaceCatalog()`: the pnpm catalog's tool ranges |

The exports point at the `.ts` and `.json` sources: there is no build. A
consumer's tsdown, Vite or Vitest config loads them as TypeScript.

### Using it

- Add `"@dropletsjs/shared": "workspace:*"` to the consumer's
  `devDependencies` and import by package name, never by a `../../` path.
- `examples/*` never depend on it: users copy them.
- Extend the tsconfig by its file path, `@dropletsjs/shared/tsconfig.base.json`,
  which resolves with or without `exports`.

### `graphCheck({ client, server })`

`client` lists the entries a browser bundle imports and `server` the server
modules whose name does not say so; both are paths under `src/` without
`.ts`, and a `server` entry ending in `/` names a folder. The plugin fails the
build when a client entry reaches server code or a Node built-in, or when the
output imports a package that is neither the package itself, a dependency nor
a peer dependency. Keep the lists in sync with the package's entries and
server modules when you add or rename one.

### Changing this package

`pnpm --filter @dropletsjs/shared typecheck` is its only script. The tsdown
plugins are tested from `packages/droplets/test/build/tsdown.test.ts`, and
`isServerPath` from `tests/packages`. A change here reaches every package's
build, so run `pnpm build` after it.

## Facts

- `@dropletsjs/shared` is `private: true`: never published. `package.json:4`
- `@dropletsjs/shared` exports `./catalog`, `./env`, `./tsconfig`, `./tsconfig.base.json`, `./tsdown` and `./vitest`, as source files. `package.json:8`
- `catalogRanges({ yaml })` reads the `catalog:` block of a pnpm-workspace.yaml, one `name: range` per line, quoted names included; `workspaceCatalog()` reads the root file. create-droplets bakes those ranges in and `tests/packages` checks the examples declare them. `catalog.ts:15`, `catalog.ts:34`
- `@dropletsjs/shared` has no build script; `typecheck` (`tsc -p tsconfig.json`) is its only script. `package.json:15`
- `@dropletsjs/shared` has no dependencies; `@types/node`, `tsdown`, `typescript`, `vite` and `vitest` are devDependencies. `package.json:18`
- `tsdown.ts` imports only types from tsdown, because the Dockerfiles install filtered, without the workspace root. `tsdown.ts:1`
- `bareImport` matches any specifier that does not start with `.`, `/` or a Windows drive (`C:\`, `C:/`). `tsdown.ts:9`
- `base` builds `src/` into `dist/` as ESM, platform `neutral`, target `es2023`. `tsdown.ts:11`
- `base` sets `fixedExtension: false`: output files end in `.js`, not `.mjs`. `tsdown.ts:17`
- `base` writes no source maps, for JS or `.d.ts`. `tsdown.ts:18`, `tsdown.ts:24`
- `base` sets `clean: true`, `report: false`, `exports: false` and `css: false`. `tsdown.ts:19`
- `base` keeps every bare import external (`deps.neverBundle: [bareImport]`). `tsdown.ts:23`
- `base` minifies and keeps function and class names. `tsdown.ts:25`
- `base` keeps legal and annotation comments in the output and drops JSDoc. `tsdown.ts:30`
- `cssInline()` loads `<file>.css?inline` as the file's text (module type `text`) and watches the file. `tsdown.ts:37`
- `isServerPath({ path })` is true for a file name containing `.server.` or starting with `+server.`, and for a path with a `server` folder segment, in any case (`Server/`, `x.SERVER.ts`). `tsdown.ts:53`, `tsdown.ts:59`
- `isServerPath` ignores a query or hash and reads `\` as `/`; it is case-sensitive. `tsdown.ts:54`
- `graphCheck` `client` and `server` are paths under `src/` without `.ts`; a `server` entry ending in `/` matches a folder prefix. `tsdown.ts:74`, `tsdown.ts:93`
- `graphCheck` resolves `client` entries as `src/<name>.ts`: a `.tsx` client entry is not checked. `tsdown.ts:124`
- `graphCheck` reads `src/` and `package.json` from tsdown's `cwd` at `buildStart`. `tsdown.ts:99`
- `graphCheck` exposes its lists as the plugin's `api: { client, server }`; `tests/packages` reads them. `tsdown.ts:98`
- `graphCheck` treats `\0`-prefixed virtual module ids as never server code. `tsdown.ts:91`
- `graphCheck` names a chunk holding server code `chunks/server/[name]-[hash].js`, any other `chunks/[name]-[hash].js`. `tsdown.ts:108`
- `graphCheck` sets the chunk names with `order: "pre"`, before rolldown-plugin-dts wraps `chunkFileNames`. `tsdown.ts:105`
- `graphCheck` fails on an import of a package that is not the package itself, a dependency or a peer dependency; devDependencies do not count. `tsdown.ts:113`, `tsdown.ts:119`
- `graphCheck` lets `node:*`, `virtual:*`, `$droplets/*`, relative imports and the package's own chunks through. `tsdown.ts:116`
- `graphCheck` lets a bare specifier through when it names a file under `src/` (a copied `.svelte`). `tsdown.ts:118`
- `graphCheck` fails when a client entry reaches a `node:` built-in, through static or dynamic imports. `tsdown.ts:134`
- `graphCheck` fails when a client entry reaches a chunk holding server code, and prints the import chain. `tsdown.ts:136`
- `happyDom` is the happy-dom environment with `handleDisabledFileLoadingAsSuccess`, so a `<link rel="stylesheet">` the element appends does not throw. `vitest.ts:10`
- `rendererTests` runs `test/**/*.test.ts` in happy-dom with a 60 s test timeout. `vitest.ts:16`
- `adapterTests` runs `test/**/*.test.ts` in the Node environment with a 60 s test and hook timeout (the fixture build runs in a `beforeAll`). `vitest.ts:21`, `vitest.ts:23`
- `FIXTURE_ROOT` is `packages/droplets/test/fixtures/app/`, the fake-renderer fixture app every adapter's tests build. `vitest.ts:26`
- `buildFixtureApp({ outDir, plugins })` empties `outDir`, then builds the fixture app with Vite's `createBuilder` and `plugins`, silently; it throws when `packages/droplets/dist/vite.js` is missing. `vitest.ts:31`
- `freePort()` resolves a port the OS has free on every interface (a probe listens on port 0, then closes): never a fixed port another run may hold. `vitest.ts:42`
- `onFreePort({ start })` calls `start(port)` with a `freePort()` and resolves what it resolves; when `start` throws because the port was taken between the probe and the bind (`EADDRINUSE`, `AddrInUse`, `already in use`, Bun's `is port <n> in use`, in the error's code or message), it tries a new port, five times in all; any other error is thrown at once. Every suite that starts a server on a port of its own starts it through `onFreePort`. `vitest.ts:64`, `vitest.ts:75`
- `listensOn({ output, port })` is whether a server's output names `:<port>` (not followed by a digit), ANSI colours stripped: Vite's `Local:` line, Bun's `Started server:`, `deno serve`'s `Listening on`, wrangler's `Ready on`. `vitest.ts:87`
- `fromBuild({ outDir })` reads `__hash` from `<outDir>/client/droplets.json` and returns an `isOurs` that holds when a response's `x-droplets-build` is that hash: the word of a built server that prints nothing (every fragment carries the header, `/health` does not). `vitest.ts:99`
- `waitForServer({ url, child, name, isOurs, output })` polls `url` every 100 ms, up to 100 times, until it answers ok and `isOurs(response)` holds (when given); it throws as soon as `child` exits, naming `name` and the exit code, followed by `output()` when given (so `onFreePort` sees a server's own words for a taken port). `vitest.ts:115`
- `stopServer({ child, timeout })` sends `child` SIGTERM and resolves once it has exited, sending SIGKILL after `timeout` ms (default 5000); it resolves at once for a missing or exited child. `vitest.ts:132`
- `loadEnvLocal()` loads the repository root's `.env.local` with `process.loadEnvFile`, only when the file exists. `env.ts:4`
- `loadEnvLocal()` finds `.env.local` two folders above `env.ts`, the repository root. `env.ts:5`
- `tsconfig.base.json` targets ES2023 with `lib` ES2023, DOM and DOM.Iterable, `module` ESNext and `moduleResolution` bundler. `tsconfig.base.json:4`
- `tsconfig.base.json` sets `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules` and `noEmit`. `tsconfig.base.json:10`
- `tsconfig.base.json` sets `allowImportingTsExtensions`: imports name the `.ts` file. `tsconfig.base.json:9`
- `tsconfig.base.json` sets no `types`: each project lists its own. `tsconfig.base.json:3`
- The package's own typecheck covers its top-level `*.ts` with Node types. `tsconfig.json:4`
