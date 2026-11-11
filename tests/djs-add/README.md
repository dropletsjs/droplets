# tests/djs-add

`djs add` end to end, as a user runs it, on a Svelte project: a droplet in
every framework (the seven others are registered in the Vite config and the
tsconfig on the way), every target, with and without the optional files,
plus script droplets. Then a type check, a build, and the built server
answering for each droplet.

```bash
pnpm build                                        # the packages' dist/ first
pnpm --filter @dropletsjs/tests-djs-add test      # this suite
pnpm test:integration                             # every tests/* suite
```

## Details

### What it needs

- Every package built: the suite runs the `djs`, `tsc` and `vite` bins from
  its own `node_modules/.bin` (`pnpm build`, or `pnpm build:dist`).
- Port 8251 free on `localhost`.

### The fixture

`test/fixture` is a Svelte-only project (`renderers: [svelte()]`, Node
adapter, element `djs-add-test`, no JSX in its tsconfig). The suite copies it
to `.tmp/project` (gitignored) and runs every `djs add` there with
`--root .tmp/project --yes`.

### The droplets

Per framework (svelte, vue, react, preact, solid, hono-jsx, handlebars, lit),
one droplet per case, named `<framework>-<case>`:

| Case | Flags | Served |
|---|---|---|
| `full` | `--target full` | `<h1>` with its name; `client.js` 200 |
| `loaded` | `--target full --hydrate visible --with server,universal,error,css` | `Hello Ana!` for `?who=Ana`; styles in `style.css` (Lit: in the shadow root) |
| `static` | `--target ssr --with server,error` | `Hello Bo!`; `client.js` 404 |
| `browser` | `--target client --with universal` | no `<h1>`; `client.js` 200 |
| `built` | `--target ssg --with server` | `Hello world!` |

Script droplets: `script-plain` and `script-loaded` (`--hydrate visible
--with server,universal,css`) render an empty entry element and serve a
`client.js`.

### What else it checks

- The Vite config ends with all eight renderers registered once, and the
  tsconfig gets JSX (`react-jsx`, `jsxImportSource: react`) and `*.tsx`.
- Refused: a name in use (`exists already`), `--hydrate none` without
  a `--target` (points at `--target ssr`), and for a script droplet
  `--target ssr`, `--hydrate none`, `--hydrate interactive`, `--with error`.

## Facts

- Frameworks covered: svelte, vue, react, preact, solid, hono-jsx, handlebars, lit. `test/add.test.ts:18`
- Cases: `full`, `loaded`, `static`, `browser`, `built`, with their `djs add` flags. `test/add.test.ts:24`
- `djs add` runs with `--root .tmp/project` and `npm_config_user_agent=pnpm/10`. `test/add.test.ts:37`
- Every droplet is added with `--yes`, as `<framework>-<case>`. `test/add.test.ts:57`
- Script droplets `script-plain` and `script-loaded` are added with `--framework script`. `test/add.test.ts:61`
- Vite config after the adds registers `[svelte(), vue(), react(), preact(), solid(), honoJsx(), handlebars(), lit()]` and has 11 imports. `test/add.test.ts:72`
- Vite config keeps its comment through the edits. `test/add.test.ts:74`
- tsconfig after the adds has `"jsx": "react-jsx", "jsxImportSource": "react"` and includes `src/**/*.tsx`. `test/add.test.ts:76`
- A name in use is refused with `exists already`. `test/add.test.ts:81`
- `--hydrate none` without a target is refused, pointing at `--target ssr`. `test/add.test.ts:84`
- Script droplet file starts its function as `const run: DropletScript = (_data, el) => {`. `test/add.test.ts:90`
- Script droplet with `--hydrate visible --with css` gets `export const hydrate = "visible";` and `import "./style.css";`, no `ssr` export. `test/add.test.ts:93`
- Script droplet refuses `--target ssr`, `--hydrate none`, `--hydrate interactive` and `--with error`. `test/add.test.ts:97`
- Type check runs `tsc -p tsconfig.json` in the project. `test/add.test.ts:109`
- Build runs `vite build`, then `node dist/server.js` with `PORT`, polled on `/health`. `test/add.test.ts:113`
- Server port is 8251. `test/add.test.ts:41`
- `full` renders its name in an `<h1>` and serves `client.js`. `test/add.test.ts:134`
- `loaded` renders `Hello Ana!` for `?who=Ana`; its styles are in `style.css`, Lit's in a `<style>` inside the markup. `test/add.test.ts:137`
- `style.css` is read with its `@import url(...)` rules followed. `test/add.test.ts:45`
- `static` (`--target ssr`) renders and has no `client.js` (404). `test/add.test.ts:143`
- `browser` (`--target client`) renders no `<h1>` on the server and serves `client.js`. `test/add.test.ts:146`
- `built` (`--target ssg`) renders `Hello world!`. `test/add.test.ts:149`
- Script droplet renders `<div style="display: contents" data-droplet-entry></div>` as its element's only content and serves `client.js`. `test/add.test.ts:152`
- Fixture is Svelte only, Node adapter. `test/fixture/vite.config.ts:8`
- Fixture element is `djs-add-test`. `test/fixture/droplets.config.ts:2`
- Fixture tsconfig has no JSX and extends `./.droplets/tsconfig.json`. `test/fixture/tsconfig.json:2`
- Test and hook timeout 300 s. `vitest.config.ts:7`
- Test script is `vitest run`. `package.json:9`
- `.tmp/` is gitignored. `../../.gitignore:42`
