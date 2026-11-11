---
title: API
description: "Everything the packages export, the files you write, and the droplet element."
---

## Files you write

| File | Exports | Runs |
| --- | --- | --- |
| `src/droplets/<name>/+droplet.<ext>` | the component; `ssr`, `hydrate`, `prerender` flags | server and browser |
| `src/droplets/<name>/+droplet.script.ts` (or `.js`) | instead of a component: default `(data, el) => void \| cleanup` (`DropletScript`); `hydrate` (`true` or `"visible"`) and `prerender`. See [Script droplets](/renderers/script/) | browser |
| `src/droplets/<name>/+droplet.server.ts` | `load`, `actions`, `handleError`, `entries`, `transform` | server |
| `src/droplets/<name>/+droplet.ts` | `props` (a Standard Schema), `load`, `handleError` | server and browser |
| `src/droplets/<name>/+error.<ext>` | the error page | server and browser |
| `src/api/**/+server.ts` | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `HEAD`, `fallback` | server |
| `src/hooks.server.ts` | `handle`, `handleError` | server |
| `src/hooks.client.ts` | `init` (`ClientInit`): called by `/index.js` before the element is defined; it may be async, but Droplets never waits for it. See [`src/hooks.client.ts`](/guides/in-the-browser/#srchooksclientts) | browser |
| `src/importmap.server.ts` | `importmap` | server |
| `src/env.ts` | `variables` (from `defineEnvVars`) | build |
| `droplets.config.ts` | default: the config | build, bundled into the server |

### `+droplet.server.ts`

```ts
export const load: (event: LoadEvent) => object | void | Promise<object | void>;
export const handleError: HandleDropletError;      // ({ error }) => { error }
export const entries: Entries;                     // () => Array<{ props?, host? }>
export const transform: Transform | Transform[];   // ({ html, ...event }) => string
export const actions: Actions;                     // { default, name: (event: ActionEvent) => data | fail() | redirect() }
```

### `+droplet.ts`

```ts
export const props: StandardSchemaV1;              // zod, valibot, arktype…
export const load: (event: DropletLoadEvent) => object | void | Promise<object | void>;
export const handleError: HandleDropletError;
```

## `$droplets/*` modules

Declared by `@dropletsjs/droplets/ambient` (add it to `compilerOptions.types`).

| Module | Exports | Where |
| --- | --- | --- |
| `$droplets/env` | `browser`, `dev`, `building` | anywhere |
| `$droplets/env/public` | `env`: public variables, static ones inlined, dynamic ones read at runtime | anywhere |
| `$droplets/env/private` | `env`: every other variable | server files only |
| `$droplets/drop` | `droplet`: the droplets server's public origin | anywhere |
| `$droplets/form` | `actionUrl(name?, options?)`: where a form posts for one of the droplet's actions; `enhanceDropletForm(form, options?)` | anywhere |
| `$droplets/server` | everything [`@dropletsjs/droplets/server`](#dropletsjsdropletsserver) exports: `json`, `text`, `error`, `redirect`, `fail`, `sequence`, `hostFrom`, the event and hook types | server files only |

Server files are those whose name ends in `server.ts` / `server.js`, and files
under a `server/` folder. Importing a server-only module anywhere else fails
the build, and no `*.server.*` file, `+server.*` route or file under a
`server/` folder may reach a browser bundle. See
[Server-only code](/guides/security/#server-only-code).

## `$droplets/drop`

```ts
import droplet from "$droplets/drop";

const response = await fetch(droplet.url("/api/counter"));
```

| Export | What it is |
| --- | --- |
| `droplet.origin` | The droplet location: where the browser loads `/index.js` from, path prefix included, without a trailing slash. |
| `droplet.url(path)` | `origin` + `path`: one of your `/api` endpoints, a file of `public/` (`droplet.url("assets/public/robots.txt")`), or any other route. An absolute URL, such as an imported file's, comes back as it is. |

A droplet runs inside someone else's page, so `fetch("/api/counter")` would
hit the host. In the browser, `origin` is where the page loaded `/index.js`
from; before `/index.js` recorded it, the root of the build the bundle came
from (`https://shop.example/mfe` for a bundle at
`https://shop.example/mfe/droplets/cart/client.js`). On the server it is the
request's
[public location](/integrate/http-contract/#x-droplet-location-the-public-location):
a trusted location header, else the single `origin` entry, else the request's
own origin. It works in components and in plain `.ts` files.

Outside a request on the server (a module's top level, read once when the
server starts) `origin` is the build's location token,
`http://droplets.invalid/__$DROPLET_LOCATION_<nonce>$__`. A fragment, its
inline data, `_data` and an action's JSON answer get it replaced with the
location of the request they answer, so a URL made at the top level and
rendered still lands on the right server. A `+server.ts` response is not
rewritten: call `droplet.url()` inside the handler, where it reads the
request, and pass an imported file's URL through it
(`droplet.url(logo)`) to put it on the request's location.

## `$droplets/form`

```ts
import { actionUrl, enhanceDropletForm } from "$droplets/form";
import type { DropletActions } from "./$types";

actionUrl<DropletActions>("add"); // https://drops.example/droplets/cart?/add&productId=p1
const stop = enhanceDropletForm<DropletActions>(form, { action: "add" });
```

`actionUrl(name?, { droplet?, props? })` returns
`${location}/droplets/<id>?/<name>&<props>&__droplet_return=<page>`: the
action `name` of the droplet rendering now (`default` without a name), on
the same location as `droplet.origin` (a token at build, replaced per
request), for the page the form is on (origin and path of `host` on the
server, of `window.location` in the browser). The same string on the
server, in the browser and in a prerender. Props that are strings, numbers
or booleans go in the query; reserved keys (`__droplet_return` among them)
never do. Outside a
render it needs `{ droplet }` (and `{ props }`), and it throws for a name
`actions` cannot export (`[A-Za-z_][\w-]*`). In the browser it knows the
render only while the component renders synchronously: call it as the
component sets up (`useState(() => actionUrl("add"))` in React, Preact and
Hono JSX). With `DropletActions` it takes only the exported names. See
[Where a form posts](/guides/actions/#where-a-form-posts).

A form posted to it without JavaScript is answered with a `303` back to its
page, the result signed in the query as `__droplet_form_<droplet>_<build>`
(needs `DROPLETS_SECRET`, 32+ bytes); the droplet renders there with it as
`form`. See [Post/Redirect/Get](/guides/actions/#without-javascript-postredirectget).

`enhanceDropletForm(form, options?)` enhances one form and returns the
function that removes it: a `POST` to its own droplet's action goes by
`fetch` with `accept: application/json`, the droplet renders again with
`form` (or the page follows a redirect), and `droplets:action` is
dispatched. Anything else is the browser's. See
[Enhancing a form](/guides/actions/#enhancing-a-form).

| Option | What it does |
| --- | --- |
| `action` | Only this action is intercepted; with `DropletActions`, one of its names, and `onResult`'s `data` is that action's. |
| `onSubmit({ form, formData, cancel })` | Before anything is sent: change `formData`, or `cancel()`. |
| `onResult({ type, status, data, update })` | In place of the default; `update()` does the default. A redirect also has `location`. |

Types: `ActionUrlOptions` (`{ droplet?, props? }`), `ActionMap`,
`ActionName`, `EnhanceOptions`, `ActionEnhanceOptions` (with `action`),
`AnyEnhanceOptions` (without), `EnhanceSubmit`, `EnhanceResult`,
`DropletActionDetail` (`detail` of `droplets:action`).

`enhanceDropletForm` and its types also come from
`@dropletsjs/droplets/enhance`, for the renderers' wrappers, with the steps
it is made of:

| Export | What it is |
| --- | --- |
| `enhanceSubmit(event, form, options?)` | One submit: what `enhanceDropletForm` runs on `submit`. |
| `submitterOf(event, form)`, `submission(event, form)`, `Submission` | The submitter, and the method, action, enctype and target the submit would use. |
| `interceptable(submit)` | Whether a submission is one an enhanced form takes: a `POST`, form-urlencoded or multipart, into `_self`. |
| `ownAction(action, location, droplet)`, `ActionTarget` | `{ url, name }` when the action is this droplet's own, by exact origin and path; else `null`. |
| `formBody(data, enctype)` | `FormData`, or `URLSearchParams` for form-urlencoded. |
| `actionAnswer(body)`, `ActionAnswer` | An action's JSON answer, checked; `null` for anything else. |
| `redirectTarget(location, base)` | An `http(s)` URL to follow, or `null`. |
| `plainCopy(data)` | A copy through JSON, for the `droplets:action` detail. |
| `ACTION_EVENT`, `DropletFormHost` | `"droplets:action"`, and the element's `actionTarget()` and `updateForm()`. |

## `djs`

The package's command line. Both commands take `--root <dir>`,
`--config <vite config>` and `--mode <mode>`.

### `djs sync`

```bash
djs sync
```

It resolves the Vite config, finds the droplets and writes `.droplets/`: each
droplet's [`./$types`](/guides/writing-droplets/#types-types) and the
`tsconfig.json` that maps them. Nothing is served or built. Use it before a
type check where `vite` has not run: `"prepare": "djs sync"`.

### `djs add`

```bash
djs add [name] [--framework <f>] [--target <t>] [--hydrate <h>] [--with <files>] [--pm <pm>] [--yes]
```

Writes `src/droplets/<name>/` (the `dropletsFolder`), then its `./$types`. In
a terminal it asks for what the options leave out; with `--yes`, or without
a terminal, it asks nothing and takes the defaults.

| Option | Values | Default |
| --- | --- | --- |
| `--framework` | `svelte`, `vue`, `react`, `preact`, `solid`, `hono-jsx` (or `hono`), `handlebars`, `lit`, `script` | asked; without a terminal, the only renderer configured |
| `--target` | `full`, `ssr`, `client`, `ssg` | `full` |
| `--hydrate` | `always`, `visible`, `interactive`, `none` | asked for `full`; implied by the others |
| `--with` | `server`, `universal`, `error`, `css`, comma-separated | asked; none |
| `--pm` | `npm`, `pnpm`, `yarn`, `bun`, `deno` | the one running `djs`, else the nearest lockfile's |
| `--yes` | | asks nothing and accepts the warnings |

The target sets the [flags](/guides/writing-droplets/#flags):

| Target | Flags | Hydrate |
| --- | --- | --- |
| `full` | `ssr` | `always`, `visible` or `interactive`; never `none` (that is `ssr`) |
| `ssr` | `ssr`, `hydrate = false` | `none`: HTML and CSS only |
| `client` | `ssr = false` | `always`; `none` warns of a blank component, `interactive` that it mounts at once |
| `ssg` | `ssr`, `prerender`, an `entries` in `+droplet.server.ts` | `always`; `none` for static HTML |

The optional files are `+droplet.server.ts` (a server load), `+droplet.ts` (a
universal load, where a props schema goes), `+error.<ext>` and styles: a
`<style>` block in Svelte, Vue and Handlebars, a `style.css` the component
imports in React, Preact, Solid and Hono JSX. With a load, the component shows a
greeting built from a `who` prop.

A framework the Vite config does not list yet is offered greyed out. Picking
it warns of what follows, and asks to go ahead:

- the renderer and the framework are installed with the package manager (the
  renderer as a dev dependency, at exactly the installed core's version: every
  `@dropletsjs/*` package is released at the same one);
- `<factory>()` goes at the end of `droplets({ renderers: [...] })` in
  `vite.config.ts`, with its import. A config it cannot edit with confidence
  (`renderers` built elsewhere, a spread, two `droplets()` calls) is left
  alone, and `djs add` prints the two lines to add before `djs sync`;
- for the first `.tsx` framework, `tsconfig.json` gets `"jsx": "react-jsx"`,
  its `jsxImportSource`, and `.tsx` files in `include`.

Every `.tsx` component it writes names its framework in a
`/** @jsxImportSource … */` comment, so React, Preact, Solid and Hono JSX droplets
can share the project.

`--framework script` writes a [script droplet](/renderers/script/),
`+droplet.script.ts`: nothing to install or register, since it is built in.
It takes no `--target` (it renders nothing on the server and always runs in
the browser), `--hydrate` is `always` or `visible`, and `--with` has no
`error`; `css` writes a `style.css` the script imports.

## `@dropletsjs/droplets/server`

The module behind `$droplets/server`.

| Export | What it is |
| --- | --- |
| `error(status, message?)` | Throws an HTTP error, answered with its status. |
| `redirect(status, location)` | Throws a redirect (300–308) to an `http(s)` URL or a path on the site; `javascript:`, protocol-relative (`//…`) or control characters throw. From an action posted without JavaScript, the target must be on the server's own origin or in `trustedOrigins` (`"*"` does not count), else `400`. |
| `hostFrom(value)` | A `host` for `handle` to set: a web URL without credentials or hash, within `trustedOrigins` when set; `null` otherwise. |
| `fail(status, data?)` | An action's failure: an `ActionFailure` with a `400`–`599` status (any other throws); the component gets `data` as `form`. Without JavaScript `data` rides in the page's URL: 2 KB at most, display only. |
| `ActionFailure`, `isActionFailure(value)` | What `fail()` returns: `{ status, data }`. |
| `HttpError`, `Redirect`, `isHttpError(value)`, `isRedirect(value)` | What `error()` and `redirect()` throw, for a `handle` or a `try` that needs to tell them apart. |
| `json(data, init?)`, `text(body, init?)` | Response helpers. |
| `sequence(...handles)` | Chains `handle` functions. |
| `Locals` | Interface to augment with your `event.locals` fields. |
| `Platform` | `{ env?, context? }` from the runtime: bindings and execution context on Workers. |
| `RequestEvent<Params>` | `{ request, url, host, params, locals, platform, cookies }`; `host` is where the droplet renders. |
| `LoadEvent` | A server load's event: `{ request, host, locals, platform, cookies, setHeaders, droplet, props }`; its `cookies` are `ReadonlyCookies`. |
| `ActionEvent` | A form action's event: `{ request, host, locals, platform, cookies, setHeaders, droplet, props }`, full `cookies`, the body unread. |
| `Action`, `Actions` | One action, and the `actions` export of `+droplet.server.ts`. |
| `ActionResult` | An action's answer in JSON: `{ type: "success" \| "failure", status, data? }` or `{ type: "redirect", status, location }`. |
| `SetHeaders` | `setHeaders` in a server load: headers for the fragment and `_data` (each once, never `set-cookie`). |
| `Cookies`, `CookieParseOptions`, `CookieSerializeOptions` | `event.cookies`: `get`, `getAll`, `set`, `delete`, `serialize`, as in SvelteKit. |
| `ReadonlyCookies` | The cookies of a droplet's load and `transform`: `get` and `getAll`. |
| `DropletLoadEvent` | A universal load's event: `{ host, props, data }`. |
| `Handle`, `ResolveFunction` | The `handle` hook. |
| `HandleServerError`, `HandleServerErrorInput` | `handleError` in `hooks.server.ts`. |
| `HandleDropletError` | `handleError` in a droplet's files. |
| `RequestHandler<Params>` | A `+server.ts` export. |
| `Entries`, `PrerenderEntry`, `Transform`, `TransformInput`, `TransformEvent` | Prerendering (`entries` returns `{ props?, host? }` events) and HTML rewriting (`transform` is one `Transform` or a list; `TransformEvent` has no `setHeaders`). |
| `HostUrlPropsErrorInPrerender`, `isHostUrlPropsErrorInPrerender(value)` | Thrown when a host-agnostic build-time render reads `host` beyond `origin`, `pathname`, `href`; stops the build. |
| `CookiesInPrerenderError`, `isCookiesInPrerenderError(value)` | Thrown when anything uses `cookies` while prerendering; stops the build. |
| `ImportMap`, `ImportMapEvent`, `ImportMapHandler` | `src/importmap.server.ts`. |

## `@dropletsjs/droplets/env`

`defineEnvVars(declaration)` declares the environment variables:
`{ NAME: { public?: boolean; static?: boolean } }`. Register its type through
`interface Register { variables: typeof variables }` to type
`$droplets/env/*`. See [Environment variables](/guides/server/#environment-variables).

| Export | What it is |
| --- | --- |
| `defineEnvVars(vars)` | Checks the declaration and returns it, typed. |
| `validateEnvDeclaration(vars)` | The check alone: throws on a name that is not a variable name, or a value that is not an options object. |
| `EnvVarOptions`, `EnvDeclaration` | One variable's options, and the declaration. |
| `Register` | The interface to augment with `variables`. |
| `PublicEnv`, `PrivateEnv` | The types of `env` in `$droplets/env/public` and `$droplets/env/private`. |

## `@dropletsjs/droplets`

| Export | What it is |
| --- | --- |
| `config(options)` | Identity helper for `droplets.config.ts`, typed as `DropletsConfig`. |
| `DropletsConfig`, `DropletsCorsOptions`, `BodyLimits`, `ResolvedDropletsConfig`, `resolveConfig` | The config and its resolution. See [Configuration](/guides/configuration/). |
| `isValidElementName(name)` | `true` when `name` is usable as `element`. |
| `DropletProps<Data, Children, Form>`, `DropletErrorProps<Err, Children>` | Component props, framework-neutral; `form` is an action's result. Each renderer exports versions with its own `children` type. |
| `DropletScript<Data>` | A script droplet's default export: `(data: Data, el: HTMLElement) => void \| (() => void)`. `./$types` exports it typed by the droplet's `Data`. |
| `InferSchemaOutput<Schema>` | A Standard Schema's output type: how `./$types` types `Props`. |
| `ClientInit` | `init` in `src/hooks.client.ts`: `() => void \| Promise<void>`, called once, before the droplet element is defined. It may be async, but Droplets never waits for it; a rejection is logged. |
| `DropletRenderError` | What the error page receives when a load failed with nothing to say. |
| `DropletStaleDetail` | `event.detail` of `droplets:stale`. |
| `DropletUpdatePayload` | The payload of the `droplets:update` HMR event: the droplet, and under `hmr` what changed (`component`, `load` or `contract`, with the flags before and after). |
| `DevNotification`, `RenderContract` | A dev notice (`key`, `message`, `detail`, `reload`), as `DropletsDevTools.notify` receives it; a droplet's `ssr`, `hydrate` and `prerender`. |
| `DevToolSource`, `DevElementInfo`, `DevElementState`, `DropletsDevTools` | The dev tool's contract. |
| `logger`, `setLogLevel`, `LogLevel`, `LogSource` | The framework's logger; `LogSource` is `"framework"` or `"drop"` (droplet code). |
| `DropletMeta`, `RenderResult`, `DropletPayload`, `PrerenderedDroplet` | Render flags, render output, a server load's outcome (`{ data }` or `{ failed, error }`) and a build-time render, for tooling. |
| `DropletsManifest`, `DropletManifestEntry`, `FALLBACK_MANIFEST` | The `dist/client/droplets.json` manifest, and the empty one a runtime answers with before it finds the build. |
| `DropletRenderInfo` | What the element knows about a render: the server's render id and the children markers. |
| The event, hook and action types, `ActionFailure`, `HostUrlPropsErrorInPrerender`, `CookiesInPrerenderError` | The same as [`@dropletsjs/droplets/server`](#dropletsjsdropletsserver)'s, for code that is not a server file. |
| `droplets`, `DropletsPluginOptions`, `DropletsCssOptions`, `DropletsPluginApi`, `DropletSummary`, `DropletRegistryPayload` | The Vite plugin and its types, as [`@dropletsjs/droplets/vite`](#dropletsjsdropletsvite) exports them. |

### Renderers

The renderer contract, documented in full in `packages/droplets/src/renderer.ts`:

| Export | What it is |
| --- | --- |
| `DropletRenderer` | What `svelte()`, `vue()` and the others return: `name`, `extensions`, `packages?`, `suffixes?`, `componentTypes?`, `plugins`, `server`, `client`, `clientSetup?`, `clientDev?`, `readFlags?`. `componentTypes` names the module whose `DropletProps` and `DropletErrorProps` a droplet's `./$types` uses. |
| `RendererScope`, `rendererScopeFilter(name)`, `RENDERER_QUERY` | `plugins` may be `(scope) => PluginOption[]`; `scope.include` matches the modules tagged `?droplets-renderer=<name>`. |
| `importsPackage(source, pkg)` | Whether module source imports `pkg` or a subpath of it, or names it in `@jsxImportSource`. |
| `defineRenderer(renderer)` | Identity helper, typed. |
| `RendererServerModule`, `ServerRenderContext`, `ServerRenderOutput` | The server side: `render(component, props, context)` → `{ html, head? }`. |
| `RendererClientModule`, `ClientRenderContext`, `DropletChildrenHost` | The browser side: `mount`, `hydrate`, `unmount`, children markers, the error boundary; `context.rendering(fn)` runs `fn` as part of the render (for a mount deferred past an `await`, so `actionUrl()` still knows the droplet). |
| `RendererClientDevModule` | What `clientDev` exports: `update(instance, props)`, new props for a live instance on a load edit. Imported under `vite dev` and in non-production builds only. |
| `ActionUrl` | `context.actionUrl(name?)` on both contexts: the URL of an action of the droplet rendering. |
| `RenderFlags`, `HydrateMode` | `{ ssr, hydrate, prerender }`; `hydrate` is `boolean \| "visible" \| "interactive"`. |
| `ComponentKind`, `ComponentModule`, `RenderProps`, `ReadFlagsInput` | `"droplet"` or `"error"`; a compiled component module; `{ data, form? }` or `{ error }`; the argument of `readFlags`. |
| `parseHydrateMode`, `withFlagDefaults` | Flag values and defaults, for renderers that read flags themselves. |
| `validateRenderers` | Extension conflicts, as the plugin checks them: renderers may share an extension only when all of them declare `packages`. `.ts`, `.js`, `.server.ts`, `.server.js`, `.script.ts` and `.script.js` are core's, and `script` is the built-in renderer's name. |

### Adapters

| Export | What it is |
| --- | --- |
| `DropletsAdapter` | What `node()`, `cloudflare()`, `bun()` and `deno()` return. |
| `AdapterBuildContext`, `AdapterPreviewContext` | Arguments of `afterBuild` and `preview`. |
| `createServerApp({ ssr, assets, config })` | The production app with platform loaders injected; adapter entries are built on it. |
| `AssetLoaders`, `ServerAppOptions`, `SsrModule` | Its types. |
| `createPrerenderedLoader`, `PRERENDER_DIR` | Reading the prerendered renders: `dist/server/_prerendered/`, or the client build's `__prerendered` directory for an adapter without `dist/server`. |
| `setRuntimeEnv` | Hands runtime environment values to `$droplets/env/private`. |

```ts
type DropletsAdapter = {
  name: string;
  serverEntry: string;            // absolute path Vite bundles as the server
  serverFile: string;             // e.g. "server.js", inside the output directory
  separateSsrBundle: boolean;     // emit server/entry-server.js on its own?
  noExternal?: Array<string | RegExp> | true;
  environment?: EnvironmentOptions;   // merged into the server build environment
  afterBuild?: (context: AdapterBuildContext) => void | Promise<void>;
  preview?: (context: AdapterPreviewContext) => Promise<{ fetch }>;
};
```

`AssetLoaders` reads the client build through `droplets.json`:
`loadEntryClient()` returns the `/index.js` stub (`__entryClient`),
`entryModule()` the path of the entry it imports (`__entryModule`, announced
in fragments' `Link` header), and `dropletStyles(id)` the droplet's
stylesheets (`css`, paths under `assets/`, shared chunks' first), which
`style.css` imports and fragments link and preload. `assetHandler` serves
`/assets/*`: `public, max-age=2592000, immutable`, except `/assets/public/*`,
the project's `public/`, sent `no-cache` with an `ETag` and answered `304`
when `If-None-Match` matches. `handle` never runs for it.

An adapter entry imports `virtual:droplets-config` (the config),
`virtual:droplets-ssr` and `virtual:droplets-manifest` (`droplets.json`);
`@dropletsjs/droplets/ambient` declares them. `virtual:droplets-ssr` exports
the functions of `SsrModule`: `renderDroplet`, `getDropletMeta`,
`loadDropletData`, `validateDropletProps`, `transformDroplet`,
`renderError`, `getEntries`, `prerenderKeys`, `getHandle`,
`getHandleError`, `matchApi`, `getImportMap` and `publicEnv`.
`packages/adapters/node` and `packages/adapters/cloudflare` are the reference.

## `@dropletsjs/droplets/vite`

`droplets(options?)` returns the Vite plugins:

```ts
type DropletsPluginOptions = {
  configFile?: string;           // default: droplets.config.{ts,mts,js,mjs} in the Vite root
  adapter?: DropletsAdapter;     // required for vite build and vite preview
  renderers?: DropletRenderer[];
  css?: {
    path?: string | false;       // default: ./src/app.css when it exists
    scoped?: boolean;            // default true
    tailwind?: boolean;          // default false: add @tailwindcss/vite
    twPreflight?: boolean;       // default true
  };
  prerender?: {
    host?: string | URL;         // where entries without a host render; else PUBLIC_URL, else host-agnostic
  };
};
```

See [`css`](/guides/configuration/#css) and [`host` at build](/guides/prerendering/#host-at-build).

Also exported: `DropletsCssOptions` (the `css` option), `DropletsPluginApi`
(`plugin.api`, what companion plugins such as the devtools use in dev),
`DropletSummary` and `DropletRegistryPayload` (the droplets as the devtools
see them, sent as `droplets:registry`), and the adapter and renderer types
`DropletsAdapter`, `AdapterBuildContext`, `AdapterPreviewContext` and
`DropletRenderer`.

For a renderer's `readFlags`: `readExportedFlags(source, where, lang?)`
parses a module (`lang` is `"js"`, `"jsx"`, `"ts"` or `"tsx"`, the default)
and returns the flags its top-level `export const` declarations set;
`readExportedFlag` and `readExportedHydrate` read one. Comments and strings
never count, and a source that does not parse declares none. Svelte and Vue
pass their module block's content. `FlagSourceLang` is the `lang` type.

## `@dropletsjs/droplets/postcss`

- `scopeStylesPlugin({ element, include? })`: the PostCSS plugin behind
  `css.scoped`, for projects with their own PostCSS config. `include(file)`
  limits it to some stylesheets. Its options are `ScopeStylesOptions`.
- `scopeSelector(selector, element, svelte?)`: the rewrite on its own;
  `scopeSelector(".p-4", "x-y")` is `"x-y .p-4"`, and with `svelte`
  `":global(x-y) .p-4"`.

## `@dropletsjs/droplets/testing`

For renderer packages; imports vitest.

- `rendererConformance({ renderer, root, element?, interactive?, adopts?, css?, enhance?, outDir? })`:
  the suite every shipped renderer passes. It builds a fixture app with the
  renderer and checks SSR, inline data, hydration, client-only mounting, the
  error page and boundary, children, prerendering, form actions, their
  URLs (the same in the server markup and after mount), native and enhanced
  submits (`enhance: "wrapper"` by default, `"attribute"` for
  `data-droplets-enhance`), Post/Redirect/Get with `DROPLETS_SECRET` (the
  redirect back, the render and hydration with the carried result, forged
  results and untrusted `Referer`s refused) and HMR, over HTTP and in
  happy-dom.
  `conformance.ts` documents the fixture it expects; its options are
  `ConformanceOptions`.
- `fakeRenderer()`: a complete reference renderer for `.fake.js` components.

## Renderer packages

| Package | Exports |
| --- | --- |
| `@dropletsjs/renderer-svelte` | `svelte({ plugin?, vitePlugin? })`, `DropletProps<Data, Form>`, `DropletErrorProps` (with a `Snippet` as `children`); `/form`: `enhanceDropletForm`, an action (`use:enhanceDropletForm={options}`) |
| `@dropletsjs/renderer-vue` | `vue({ plugin?, vitePlugin? })`, `DropletProps<Data, Form>`, `DropletErrorProps`; `/children`: `DropletChildren`; `/form`: `useEnhanceDropletForm(formRef, options?)`, a composable |
| `@dropletsjs/renderer-solid` | `solid({ plugin?, vitePlugin? })`, `DropletProps<Data, Form>`, `DropletErrorProps`; `/form`: `enhanceDropletForm`, a directive (`use:enhanceDropletForm={options}`) |
| `@dropletsjs/renderer-react` | `react({ plugin?, vitePlugin? })`, `DropletProps<Data, Form>`, `DropletErrorProps`; `/form`: `useEnhanceDropletForm(formRef, options?)`, a hook |
| `@dropletsjs/renderer-preact` | `preact({ plugin? })`, `DropletProps<Data, Form>` (`data` always the value), `DropletErrorProps`; `/form`: `useEnhanceDropletForm(formRef, options?)`, a hook |
| `@dropletsjs/renderer-hono-jsx` | `honoJsx({ plugin? })`, `DropletProps<Data, Form>`, `DropletErrorProps`; `/form`: `useEnhanceDropletForm(formRef, options?)`, a hook |
| `@dropletsjs/renderer-handlebars` | `handlebars({ partials?, helpers?, compile? })`, `DropletContext<Data, Form>`, `DropletErrorContext`, `HandlebarsHelpers`; the `{{action "name"}}` helper (`actionUrl`); `data-droplets-enhance` on a form enhances it |

Each `/form` wrapper applies `enhanceDropletForm` of `$droplets/form` to
one form once it is in the page and removes it when the form goes, with
the same options (typed with `DropletActions`). The URL itself is
`actionUrl()` of `$droplets/form` in every framework. The root export of
each package is the Vite plugin factory, for `vite.config.ts` only.

## `@dropletsjs/devtools`

`dropletsDevtools()`: a Vite plugin, active in `vite dev` only. Serves the
[devtools page](/guides/development/#the-devtools-page) at `/`, the
[dev tool](/guides/development/#the-dev-tool) module, and
`/__droplets/devtools.json` (the droplets and their flags).

## Adapters

- `node()` from `@dropletsjs/adapter-node`: `dist/server.js`. Also exports
  `createNodeServerApp(paths, config)`.
- `cloudflare({ assetsBinding? })` from `@dropletsjs/adapter-cloudflare`:
  `dist/worker.js`; `assetsBinding` defaults to `ASSETS`.
- `bun()` from `@dropletsjs/adapter-bun`: `dist/server.js`, default export
  `{ port, fetch }`, served by `bun dist/server.js`.
- `deno()` from `@dropletsjs/adapter-deno`: `dist/server.js`, default export
  `{ fetch }`, served by `deno serve -A dist/server.js`.

## `dist/server.js`

Running it with Node or Bun listens on `server.port` (or `PORT`); with Deno,
`deno serve` picks the port. Importing it does not listen; the default export
has `fetch`:

```ts
const droplets = (await import("./dist/server.js")).default;
const response: Response = await droplets.fetch(new Request("http://localhost/droplets/hello"));
```

## The droplet element

`<djs-droplet>` by default; `element` renames it. Defined by `/index.js`.

| Attribute | Written by | Meaning |
| --- | --- | --- |
| `data-droplet` | server, host | The droplet id. Unknown ids are left untouched. |
| `data-params` | host | Plain JSON props. |
| `data-context` | server, host | Base64 JSON `{ host, props }`, when no `[data-droplet-context]` is inlined. |
| `data-hydrate` | host | `true`, `false`, `visible` or `interactive`: overrides the droplet's mode. |
| `data-build` | server | The build that rendered it. |
| `data-render-id` | server | The server render's id. |
| `data-droplet-error` | server | The markup is the error page. |

Children: `<script type="application/text" data-droplet-context>`,
`<script type="application/text" data-droplet-data>`, `<link rel="stylesheet"
data-droplet-style>` to the droplet's `style.css` (added by the element, with
`<link rel="preload" data-droplet-preload>` for the stylesheets it imports, when
the fragment brought none), `<div data-droplet-entry>` with the markup (created if
missing), and the host's `<div data-droplet-slot>`. Nothing goes into `<head>`.

| Event | When |
| --- | --- |
| `droplets:stale` | The droplet comes from another build than the loaded `index.js`. Bubbles to `window`; `detail` is `{ element, droplet, loaded, served }`. |
| `droplets:action` | An enhanced form's action answered. On `window`; `detail` is `{ droplet, action, type, status, data }`. |

| Method | What it does |
| --- | --- |
| `actionTarget()` | `{ droplet, location }`: where this droplet's actions are; `null` while it renders no known droplet of this build. |
| `updateForm(form)` | Renders the droplet again with `form`, its loads run again; a droplet that does not hydrate gets its fragment rendered with `form` swapped in. What an enhanced form calls. |

A form with `data-droplets-enhance` in a droplet's own markup is enhanced
by the element, for any renderer.

`index.js` query parameters, in `vite dev` only: `strategy=hmr|remount|reload|manual`
and `injectTool=true|false`. See [Development](/guides/development/). In a
build, `/index.js` is a stub that imports `assets/index.<hash>.js`; see
[Caching](/guides/security/#caching).
