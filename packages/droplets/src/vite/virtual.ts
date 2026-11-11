import type { Plugin } from "vite";
import { resolve } from "node:path";
import { discoverApiRoutes, type ApiRouteEntry } from "../core/api-routes.ts";
import { discoverDroplets, type DropletEntry } from "../core/discover.ts";
import { buildPrivateEnvCode, buildPublicEnvCode, dynamicPublicNames } from "../core/env.ts";
import { fileExists } from "../core/fs.ts";
import {
  clientInitModulePath,
  enhanceModulePath,
  entryServerPath,
  envStorePath,
  formModulePath,
  hostTokensModulePath,
  loadModulePath,
  propsModulePath,
  requestStorePath,
  serverModulePath,
  serverRecordsModulePath,
  toViteFsPath,
} from "../core/paths.ts";
import type { DevStrategy } from "../core/config.ts";
import { sharingRenderers, type DropletRenderer } from "../renderer.ts";
import { isScriptDroplet } from "../script/index.ts";
import { tailwindActive } from "./css.ts";
import { isServerPath, projectPath } from "./server-only.ts";
import { componentSpecifier } from "./renderer-graphs.ts";
import { locationScript, publicEnvScript, serverKey } from "../runtime/server-records.ts";
import { bundleLocation, CLIENT_HOOKS_FILES, isFixed, HOOKS_FILES, IMPORTMAP_FILES, rendererNamed, type PluginState } from "./state.ts";

/** Registry of droplets. Resolves to different code per environment. */
export const VIRTUAL_DROPLETS = "virtual:droplets";
/** What `index.js` reads under `vite dev` only: `dev.strategy`, `dev.injectTool`, the dev tool's URL. */
export const VIRTUAL_DROPLETS_DEV = "virtual:droplets-dev";
/** `browser` and `dev`, for droplet authors. Anywhere. */
export const VIRTUAL_ENV = "$droplets/env";
/** Events, `handle`, `json()`, `error()`: server code only. */
export const VIRTUAL_SERVER = "$droplets/server";
/** Public variables from `src/env.ts`, inlined. Anywhere. */
export const VIRTUAL_ENV_PUBLIC = "$droplets/env/public";
/** Private variables from `src/env.ts`. Server code only. */
export const VIRTUAL_ENV_PRIVATE = "$droplets/env/private";
/** The droplets server as the browser reaches it: `droplet.origin`, `droplet.url()`. Anywhere. */
export const VIRTUAL_DROP = "$droplets/drop";
/** `actionUrl()`: where a droplet's forms post. Anywhere. */
export const VIRTUAL_FORM = "$droplets/form";

/** Modules that would leak secrets or server code into a browser bundle. */
const SERVER_ONLY = new Set([VIRTUAL_SERVER, VIRTUAL_ENV_PRIVATE]);

/**
 * Whether a project file may import `$droplets/server` or
 * `$droplets/env/private`: it is a server file (`isServerPath`: `+server.ts`,
 * `hooks.server.ts`, `db.server.tsx`, a file under a `server/` folder).
 * Files outside the project (dependencies, the framework, virtual modules)
 * are not checked.
 */
type MayImportServerOnlyInput = { root: string; importer: string };

export function mayImportServerOnly({ root, importer }: MayImportServerOnlyInput): boolean {
  const rel = projectPath({ root, id: importer });
  return rel === null || isServerPath({ path: rel });
}

/** One build entry per droplet: `virtual:droplet-client?name=<folder>`. */
export const VIRTUAL_CLIENT = "virtual:droplet-client";
/** Global stylesheet entry. */
export const VIRTUAL_CSS = "virtual:droplets-css";
/** The project's `droplets.config.ts`, bundled into the production server. */
export const VIRTUAL_CONFIG = "virtual:droplets-config";
/** The SSR renderer, for adapter entries that inline it. */
export const VIRTUAL_SSR = "virtual:droplets-ssr";
/** `dist/client/droplets.json`, for adapter entries that bundle it. */
export const VIRTUAL_MANIFEST = "virtual:droplets-manifest";

const VIRTUAL_CSS_FILE = "virtual:droplets-css-file.css";

/** Theme and utilities only: without the reset, or unscoped, where it would hit the host page. */
export const TAILWIND_WITHOUT_PREFLIGHT = '@import "tailwindcss/theme" layer(theme);\n@import "tailwindcss/utilities" layer(utilities);\n';
/** With scoping, the reset is confined to the element and becomes the droplets' base. */
export const TAILWIND_FULL = '@import "tailwindcss";\n';
/**
 * Where the client registry leaves room for the droplets' stylesheets. They
 * are only known once the client build is written; `vite build` fills it in.
 */
export const STYLES_PLACEHOLDER = "__DROPLETS_STYLES__";
/** The loader's public URL; resolved so Vite can process it in dev pages. */
const LOADER_URL = "/index.js";

type IdInput = { id: string };

/** Vite's convention: resolved virtual ids are prefixed with a NUL byte. */
function resolved({ id }: IdInput): string {
  return `\0${id}`;
}

export const RESOLVED_VIRTUAL_DROPLETS = resolved({ id: VIRTUAL_DROPLETS });
const RESOLVED_DROPLETS_DEV = resolved({ id: VIRTUAL_DROPLETS_DEV });

const RESOLVED_ENV = resolved({ id: VIRTUAL_ENV });
const RESOLVED_ENV_PUBLIC = resolved({ id: VIRTUAL_ENV_PUBLIC });
const RESOLVED_ENV_PRIVATE = resolved({ id: VIRTUAL_ENV_PRIVATE });
const RESOLVED_DROP = resolved({ id: VIRTUAL_DROP });
const RESOLVED_FORM = resolved({ id: VIRTUAL_FORM });
const RESOLVED_CSS = resolved({ id: VIRTUAL_CSS });
const RESOLVED_CSS_FILE = resolved({ id: VIRTUAL_CSS_FILE });
const RESOLVED_CONFIG = resolved({ id: VIRTUAL_CONFIG });
const RESOLVED_DROPS_CLIENT = resolved({ id: "droplets:loader" });
const RESOLVED_CLIENT_PREFIX = resolved({ id: VIRTUAL_CLIENT });

type ClientEntryIdInput = { folderName: string };

export function clientEntryId({ folderName }: ClientEntryIdInput): string {
  return `${VIRTUAL_CLIENT}?name=${encodeURIComponent(folderName)}`;
}

export function parseClientName({ id }: IdInput): string | null {
  const queryIndex = id.indexOf("?");
  if (queryIndex === -1) return null;
  const name = new URLSearchParams(id.slice(queryIndex + 1)).get("name");
  return name?.trim() ? name.trim() : null;
}

/** What `buildServerCode` needs beyond the droplets. */
export type ServerCodeExtras = {
  apiRoutes?: ApiRouteEntry[];
  /** Root-relative API folder: `/src/api`. */
  apiGlobRoot?: string;
  /** Root-relative hooks file, e.g. `/src/hooks.server.ts`, or `null`. */
  hooksFile?: string | null;
  /** Root-relative `src/importmap.server.ts`, or `null`. */
  importMapFile?: string | null;
  /** The configured renderers; every entry's renderer must be among them. */
  renderers?: DropletRenderer[];
  /** Public variables read at runtime, which `/index.js` hands to the page. */
  publicEnvNames?: string[];
  /** The nonce of the location tokens this bundle writes (see `hostTokens`); none when the build fixes `location` and `host`. */
  tokenNonce?: string | undefined;
};

type ModulePathInput = { file: string };

/** An absolute module path as an import specifier Vite resolves in any environment. */
function modulePath({ file }: ModulePathInput): string {
  return JSON.stringify(file.replace(/\\/g, "/"));
}

/**
 * One import per renderer module actually used, named `renderer_<n>`.
 * Returns the import lines and a lookup from renderer name to variable.
 */
type RendererImportsInput = {
  entries: readonly DropletEntry[];
  renderers: readonly DropletRenderer[];
  pick: (renderer: DropletRenderer) => string;
};

function rendererImports({ entries, renderers, pick }: RendererImportsInput): { imports: string[]; variable: (name: string) => string } {
  const imports: string[] = [];
  const variables = new Map<string, string>();
  const used = new Set<string>();
  for (const entry of entries) {
    used.add(entry.renderer);
  }
  for (const name of [...used].sort()) {
    const renderer = rendererNamed({ renderers, name });
    const variable = `renderer_${variables.size}`;
    variables.set(name, variable);
    imports.push(`import * as ${variable} from ${modulePath({ file: pick(renderer) })};`);
  }
  return {
    imports,
    variable: (name) => {
      const variable = variables.get(name);
      if (!variable) throw new Error(`droplets: no renderer named "${name}" is configured`);
      return variable;
    },
  };
}

export type BuildServerCodeInput = ServerCodeExtras & { entries: readonly DropletEntry[]; globRoot: string };

/**
 * The server registry: static imports so the bundler can see the whole graph,
 * with load functions wrapped in thunks so they stay lazy per request.
 */
export function buildServerCode({
  entries,
  globRoot,
  apiRoutes = [],
  apiGlobRoot = "/src/api",
  hooksFile,
  importMapFile,
  renderers: configured = [],
  publicEnvNames = [],
  tokenNonce,
}: BuildServerCodeInput): string {
  const members: string[] = [];
  const routes: string[] = [];
  const renderers = rendererImports({ entries, renderers: configured, pick: (r) => r.server });
  const imports: string[] = [...renderers.imports];
  const shared = sharingRenderers({ renderers: configured });
  const component = (path: string, renderer: string) => componentSpecifier({ path, renderer, shared });

  apiRoutes.forEach((route, index) => {
    const variable = `api_${index}`;
    imports.push(`import * as ${variable} from ${JSON.stringify(`${apiGlobRoot}/${route.file}`)};`);
    routes.push(`  { id: ${JSON.stringify(route.id)}, segments: ${JSON.stringify(route.segments)}, module: ${variable} },`);
  });

  if (hooksFile) {
    imports.push(`import * as hooks from ${JSON.stringify(hooksFile)};`);
  }
  if (importMapFile) {
    imports.push(`import * as importMapModule from ${JSON.stringify(importMapFile)};`);
  }

  entries.forEach((entry, index) => {
    const base = `${globRoot}/${entry.name}`;
    const componentVar = `component_${index}`;
    const loadVar = entry.hasLoad ? `load_${index}` : null;
    const serverVar = entry.hasServerLoad ? `serverLoad_${index}` : null;
    const errorVar = entry.hasError && entry.errorFile ? `error_${index}` : null;
    if (errorVar) {
      imports.push(`import * as ${errorVar} from ${JSON.stringify(component(`${base}/${entry.errorFile}`, entry.renderer))};`);
    }

    if (isScriptDroplet(entry)) {
      // Browser code only, never evaluated on the server: its renderer renders nothing.
      imports.push(`const ${componentVar} = Object.freeze({});`);
    } else {
      imports.push(`import * as ${componentVar} from ${JSON.stringify(component(`${base}/${entry.file}`, entry.renderer))};`);
    }
    if (loadVar) {
      imports.push(`import * as ${loadVar} from ${JSON.stringify(`${base}/+droplet.ts`)};`);
    }
    if (serverVar) {
      imports.push(`import * as ${serverVar} from ${JSON.stringify(`${base}/+droplet.server.ts`)};`);
    }

    members.push(
      [
        `  ${JSON.stringify(entry.id)}: {`,
        `    component: ${componentVar},`,
        `    renderer: ${renderers.variable(entry.renderer)},`,
        `    ssr: ${entry.ssr},`,
        `    hydrate: ${JSON.stringify(entry.hydrate)},`,
        `    prerender: ${entry.prerender === true},`,
        `    load: ${loadVar ? `() => Promise.resolve(${loadVar})` : "undefined"},`,
        `    serverLoad: ${serverVar ? `() => Promise.resolve(${serverVar})` : "undefined"},`,
        `    error: ${errorVar ?? "undefined"},`,
        `  },`,
      ].join("\n"),
    );
  });

  return [
    ...imports,
    "const droplets = {",
    ...members,
    "};",
    "export default droplets;",
    "export const api = [",
    ...routes,
    "];",
    hooksFile ? "export { hooks };" : "export const hooks = {};",
    importMapFile ? "export { importMapModule };" : "export const importMapModule = {};",
    `export const publicEnvNames = ${JSON.stringify(publicEnvNames)};`,
    tokenNonce === undefined ? "export const tokenNonce = undefined;" : `export const tokenNonce = ${JSON.stringify(tokenNonce)};`,
    "",
  ].join("\n");
}

/** `base` + `path`, with exactly one slash between them. */
const JOIN = `const join = (base, path) => \`\${base.replace(/\\/+$/, "")}/\${String(path).replace(/^\\/+/, "")}\`;`;

/**
 * `url(base, path)`: an absolute URL as it is (a file the bundle imports,
 * which the build put on the location already), anything else joined to
 * `base`.
 */
const URL_OF = [JOIN, "const url = (base, path) => /^[a-z][a-z0-9+.-]*:/i.test(String(path)) ? String(path) : join(base, path);"].join(
  "\n",
);

/**
 * `$droplets/drop` in the browser: where the page loads this build's
 * droplets from, as `/index.js` recorded it from its own URL; without it,
 * the root of the build the bundle belongs to (`serverLocation`).
 */
type BuildDropClientCodeInput = { key: string; recordsModule?: string };

export function buildDropClientCode({ key, recordsModule = serverRecordsModulePath }: BuildDropClientCodeInput): string {
  return [
    `import { serverLocation } from ${modulePath({ file: recordsModule })};`,
    `const origin = () => serverLocation({ key: ${JSON.stringify(key)} });`,
    URL_OF,
    "export const droplet = Object.freeze({",
    "  get origin() { return origin(); },",
    "  url(path) { return url(origin(), path); },",
    "});",
    "export default droplet;",
    "",
  ].join("\n");
}

/**
 * `$droplets/drop` on the server: the current request's public location;
 * outside a request (a module's top level) the bundle's location token
 * `location`, which every fragment and its data have replaced for theirs.
 * A path that starts with the token (a file the bundle imports) gets the
 * request's location in its place. With `isFixed`, `location` is the one
 * location every request has, and nothing is replaced.
 */
type BuildDropServerCodeInput = { requestStore: string; location: string; isFixed?: boolean };

export function buildDropServerCode({ requestStore, location, isFixed = false }: BuildDropServerCodeInput): string {
  if (isFixed) {
    return [
      `const origin = ${JSON.stringify(location)};`,
      URL_OF,
      "export const droplet = Object.freeze({",
      "  origin,",
      "  url(path) { return url(origin, path); },",
      "});",
      "export default droplet;",
      "",
    ].join("\n");
  }
  return [
    `import { requestInfo } from ${modulePath({ file: requestStore })};`,
    `const token = ${JSON.stringify(location)};`,
    "const origin = () => requestInfo()?.origin ?? token;",
    URL_OF,
    "export const droplet = Object.freeze({",
    "  get origin() { return origin(); },",
    "  url(path) {",
    "    const value = String(path);",
    "    return value.startsWith(token) ? origin() + value.slice(token.length) : url(origin(), value);",
    "  },",
    "});",
    "export default droplet;",
    "",
  ].join("\n");
}

/** What `actionUrl()` of `$droplets/form` says outside a render, without `{ droplet }`. */
const NO_RENDER =
  "actionUrl() of $droplets/form knows the droplet only while one renders: call it as the component sets up (React, Preact and Hono JSX: useState(() => actionUrl(...))), or pass { droplet }";

/** Expressions in the generated module, and the module `enhanceDropletForm` comes from. */
type ActionUrlCodeInput = { current: string; location: string; page: string; enhanceModule: string };

/**
 * `actionUrl()` of `$droplets/form`, shared by both variants: the droplet
 * and its props from the render in progress unless given; and
 * `enhanceDropletForm`, which only ever runs in the browser.
 */
function actionUrlCode({ current, location, page, enhanceModule }: ActionUrlCodeInput): string {
  return [
    `export { enhanceDropletForm } from ${JSON.stringify(enhanceModule)};`,
    "export function actionUrl(name, options = {}) {",
    `  const render = ${current};`,
    "  const droplet = options.droplet ?? render?.droplet;",
    `  if (typeof droplet !== "string" || droplet === "") throw new Error(${JSON.stringify(NO_RENDER)});`,
    "  const props = options.props ?? (render?.droplet === droplet ? render.props : undefined);",
    `  return actionHref(${location}, droplet, props, name, ${page});`,
    "}",
    "export default actionUrl;",
    "",
  ].join("\n");
}

/**
 * `$droplets/form` in the browser: the render in progress, on the location
 * `/index.js` recorded (as `$droplets/drop`), for the page in
 * `window.location`.
 */
type BuildFormClientCodeInput = { key: string; formModule: string; enhanceModule?: string; recordsModule?: string };

export function buildFormClientCode({
  key,
  formModule,
  enhanceModule = enhanceModulePath,
  recordsModule = serverRecordsModulePath,
}: BuildFormClientCodeInput): string {
  return [
    `import { actionHref, browserPage, currentRender } from ${JSON.stringify(formModule)};`,
    `import { serverLocation } from ${modulePath({ file: recordsModule })};`,
    `const origin = () => serverLocation({ key: ${JSON.stringify(key)} });`,
    actionUrlCode({ current: "currentRender()", location: "render?.location ?? origin()", page: "browserPage()", enhanceModule }),
  ].join("\n");
}

/**
 * `$droplets/form` on the server: the droplet the current request renders,
 * on its public location (`location` of the config; without it a trusted
 * location header, else the request's origin, and a token at build), for
 * the page of `event.host` (tokens at build).
 */
type BuildFormServerCodeInput = { requestStore: string; formModule: string; location: string; enhanceModule?: string };

export function buildFormServerCode({
  requestStore,
  formModule,
  location,
  enhanceModule = enhanceModulePath,
}: BuildFormServerCodeInput): string {
  return [
    `import { requestInfo } from ${JSON.stringify(requestStore)};`,
    `import { actionHref } from ${JSON.stringify(formModule)};`,
    actionUrlCode({
      current: "requestInfo()?.render",
      location: `requestInfo()?.origin ?? ${JSON.stringify(location)}`,
      page: "requestInfo()?.page",
      enhanceModule,
    }),
  ].join("\n");
}

/** What `index.js` reads under `vite dev` only: see `DropletsConfig["dev"]`. */
export type ClientDevOptions = { strategy: DevStrategy; injectTool: boolean; toolUrl: string | null };

/** `virtual:droplets-dev`, imported by the entry's dev module alone, which a production build drops. */
export function buildClientDevCode({ strategy, injectTool, toolUrl }: ClientDevOptions): string {
  return [
    `export const strategy = ${JSON.stringify(strategy)};`,
    `export const injectTool = ${JSON.stringify(injectTool)};`,
    `export const toolUrl = ${JSON.stringify(toolUrl)};`,
    "",
  ].join("\n");
}

/**
 * `init` of `src/hooks.client.ts`, called as the registry evaluates: the
 * entry client imports the registry first, so `init` has run before the
 * entry's body defines the element. Never awaited. Nothing at all without
 * the file.
 */
type ClientInitCodeInput = { clientHooksFile: string; initModule?: string };

export function clientInitCode({ clientHooksFile, initModule = clientInitModulePath }: ClientInitCodeInput): string {
  return [
    `import * as clientHooks from ${JSON.stringify(clientHooksFile)};`,
    `import { runClientInit } from ${modulePath({ file: initModule })};`,
    `runClientInit(clientHooks, ${JSON.stringify(clientHooksFile.replace(/^\//, ""))});`,
    "",
  ].join("\n");
}

/**
 * The client registry: ids and flags only. Components are never imported
 * here — each droplet is its own bundle, fetched on demand. With
 * `src/hooks.client.ts` (`clientHooksFile`, root-relative), its `init` too.
 */
export type BuildClientCodeInput = {
  entries: readonly DropletEntry[];
  buildHash: string;
  elementName?: string;
  /** `vite build`: the stylesheets come from the build, not the dev server. */
  isBuilding?: boolean;
  clientHooksFile?: string | null;
};

export function buildClientCode({
  entries,
  buildHash,
  elementName = "djs-droplet",
  isBuilding = false,
  clientHooksFile = null,
}: BuildClientCodeInput): string {
  const flag = (e: DropletEntry) => `  ${JSON.stringify(e.id)}: true,`;
  const ids = entries.map(flag);
  // `true`, `"visible"` or `"interactive"`: when the element hydrates.
  const hydrating = entries.filter((e) => e.hydrate !== false).map((e) => `  ${JSON.stringify(e.id)}: ${JSON.stringify(e.hydrate)},`);
  // Only these have server data to fetch from `_data`.
  const serverLoading = entries.filter((e) => e.hasServerLoad).map(flag);
  const scripts = entries.filter((e) => isScriptDroplet(e)).map(flag);

  return [
    // Dev only: Vite injects the shared stylesheet and keeps it updated. A
    // build lists it first among each droplet's stylesheets instead.
    ...(isBuilding ? [] : [`import ${JSON.stringify(VIRTUAL_CSS)};`]),
    "const droplets = {};",
    "export default droplets;",
    `export const buildHash = ${JSON.stringify(buildHash)};`,
    `export const elementName = ${JSON.stringify(elementName)};`,
    "export const dropletsById = {",
    ...ids,
    "};",
    "export const dropletsHydrateById = {",
    ...hydrating,
    "};",
    "export const dropletsServerLoadById = {",
    ...serverLoading,
    "};",
    "export const dropletsScriptById = {",
    ...scripts,
    "};",
    // Stylesheets per droplet, relative to the server: filled in once the
    // build is written. In dev, component styles come with the JavaScript.
    isBuilding
      ? `export const dropletsStylesById = JSON.parse(${JSON.stringify(STYLES_PLACEHOLDER)});`
      : "export const dropletsStylesById = {};",
    ...(clientHooksFile ? [clientInitCode({ clientHooksFile })] : [""]),
  ].join("\n");
}

/**
 * New `data` (and `form`) for a live instance, which keeps its state; on
 * `false` the element remounts, as it does for a module without `update`.
 */
const UPDATE_EXPORT = `
export async function update(handle, data, info) {
  if (!handle?.engine) return false;
  const props = info && info.form !== undefined ? { data, form: info.form } : { data };
  const done = await withRender(handle.rendering, () => updateInstance(handle.instance, props));
  return done !== false;
}
`;

/** What `createClientModuleCode` needs to know about one droplet. */
export type ClientModuleInput = Pick<DropletEntry, "id" | "name" | "file" | "renderer" | "hasError" | "errorFile">;

export type CreateClientModuleCodeInput = {
  globRoot: string;
  entry: ClientModuleInput;
  renderers: DropletRenderer[];
  /** The dev parts: `update` for a load edit, the HMR fallback. */
  isDev?: boolean;
  propsModule?: string;
  loadModule?: string;
  formModule?: string;
};

/**
 * A single droplet's browser entry: the props schema, `load` and
 * `handleError` of `+droplet.ts`, the component with its renderer, and the
 * error page, in the same framework.
 *
 * Exports, as the custom element (`entry-client`) calls them:
 * `default(target, data, host, info)` mounts or hydrates the droplet,
 * `renderError(target, error, host, info)` the error page, `unmount(handle)`
 * tears either down. With `isDev`, the module also dispatches
 * `droplets:hot-fallback` for an edit no framework HMR took, and with a
 * renderer that has a `clientDev` module exports `update(handle, data,
 * info)`, for a load edit. `host` is the
 * children host, `info` carries the server's `renderId`, the
 * server-rendered markers, the `form` a form action's result rendered
 * with, and, for a droplet
 * mounted with `data` still to come, `handleError`: the renderer's error
 * boundary then shows the error page in place of what fails to render.
 */
export function createClientModuleCode({
  globRoot,
  entry,
  renderers,
  isDev = false,
  propsModule = propsModulePath,
  loadModule = loadModulePath,
  formModule = formModulePath,
}: CreateClientModuleCodeInput): string {
  const base = `${globRoot}/${entry.name}`;
  const loadFile = `${base}/+droplet.ts`;
  const id = JSON.stringify(entry.id);
  const renderer = rendererNamed({ renderers, name: entry.renderer });
  const withError = entry.hasError && entry.errorFile;
  const shared = sharingRenderers({ renderers });

  const componentModule = JSON.stringify(componentSpecifier({ path: `${base}/${entry.file}`, renderer: entry.renderer, shared }));
  const errorModule = withError
    ? JSON.stringify(componentSpecifier({ path: `${base}/${entry.errorFile}`, renderer: entry.renderer, shared }))
    : null;
  const devModule = isDev ? renderer.clientDev : undefined;
  const imports = [
    ...(renderer.clientSetup ? [`import ${modulePath({ file: renderer.clientSetup })};`] : []),
    `import * as renderer from ${modulePath({ file: renderer.client })};`,
    ...(devModule ? [`import { update as updateInstance } from ${modulePath({ file: devModule })};`] : []),
    `import * as component from ${componentModule};`,
    ...(errorModule ? [`import * as errorComponent from ${errorModule};`] : ["const errorComponent = undefined;"]),
  ];

  return `${imports.join("\n")}
import { validateProps } from ${JSON.stringify(propsModule)};
import { checkLoadResult, runHandleError } from ${JSON.stringify(loadModule)};
import { actionUrlFor, browserPage, withRender } from ${JSON.stringify(formModule)};

const loaders = import.meta.glob(${JSON.stringify(loadFile)});
const loader = loaders[${JSON.stringify(loadFile)}];

function universal() {
  return loader ? loader() : Promise.resolve(undefined);
}

/** The \`props\` schema from +droplet.ts over the props; unchanged without one. */
export async function validate(props) {
  const mod = await universal();
  return validateProps(${id}, mod?.props, props);
}

/** The load of +droplet.ts: server data in, the component's \`data\` out. */
export async function load(event) {
  const mod = await universal();
  if (typeof mod?.load !== "function") return event.data;
  return checkLoadResult(${id}, "+droplet.ts", await mod.load(event));
}

/** \`handleError\` of +droplet.ts: what the error page receives as \`error\`. */
export async function handleError(error) {
  const mod = await universal();
  return runHandleError(${id}, "+droplet.ts", mod?.handleError, error);
}

function freshRenderId() {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Hydrates server markup in place, or mounts into an empty target. The
 * engine may answer with a promise: the handle is ready once it resolves.
 * A droplet mounted with \`info.handleError\` gets the error page for its
 * renderer's error boundary.
 */
async function show(module, kind, target, props, host, info) {
  const hydrating = target.childNodes.length > 0;
  const boundary = kind === "droplet" && !hydrating && errorComponent && info?.handleError;
  const location = info?.location ?? "";
  const context = {
    droplet: ${id},
    kind,
    children: host,
    renderId: (hydrating && info?.renderId) || freshRenderId(),
    markers: hydrating && info?.markers ? info.markers : () => [],
    // The page in \`window.location\`: what the server wrote from \`event.host\`.
    actionUrl: actionUrlFor(location, ${id}, info?.props, browserPage()),
    // For an engine that renders after an await: the render in progress again.
    rendering: (render) => withRender(rendering, render),
    ...(boundary ? { error: { module: errorComponent, handle: info.handleError } } : {}),
  };
  // For \`actionUrl()\` of \`$droplets/form\` while the component renders.
  const rendering = { droplet: ${id}, location, props: info?.props };
  const instance = await withRender(rendering, () =>
    hydrating ? renderer.hydrate(module, target, props, context) : renderer.mount(module, target, props, context)
  );
  return { engine: renderer, instance, rendering };
}

export default function render(target, data, host, info) {
  // \`form\`, the result of a form action, only when there is one.
  const props = info && info.form !== undefined ? { data, form: info.form } : { data };
  return show(component, "droplet", target, props, host, info);
}

/** Shows the error page; \`null\` when the droplet has none. */
export function renderError(target, error, host, info) {
  return errorComponent ? show(errorComponent, "error", target, { error }, host, info) : null;
}

export function unmount(handle) {
  return handle?.engine?.unmount(handle.instance);
}
${devModule ? UPDATE_EXPORT : ""}${isDev ? hotFallback({ modules: [componentModule, ...(errorModule ? [errorModule] : [])], id }) : ""}`;
}

/**
 * An edit that no HMR of the framework takes (an engine without one, an
 * export the framework cannot swap) stops here rather than reloading the
 * host's page, and the element remounts the droplet in place.
 */
type HotFallbackInput = { modules: readonly string[]; id: string };

function hotFallback({ modules, id }: HotFallbackInput): string {
  return `
if (import.meta.hot) {
  import.meta.hot.accept([${modules.join(", ")}], () => {
    globalThis.dispatchEvent(new CustomEvent("droplets:hot-fallback", {
      detail: { droplet: ${id}, origin: new URL(import.meta.url).origin },
    }));
  });
}
`;
}

/**
 * The production server's view of `droplets.config.ts`, and `tokens`: the
 * replacers of `host-tokens` when the build computes `location` or `host`
 * per request, `undefined` when it fixes both, so that module is never
 * bundled.
 */
type BuildConfigCodeInput = { configPath: string | null; hostTokensModule?: string | undefined };

export function buildConfigCode({ configPath, hostTokensModule }: BuildConfigCodeInput): string {
  const tokens =
    hostTokensModule === undefined
      ? "export const tokens = undefined;\n"
      : `export { replacers as tokens } from ${modulePath({ file: hostTokensModule })};\n`;
  if (!configPath) return `export default {};\n${tokens}`;
  return `import userConfig from ${JSON.stringify(configPath)};\nexport default userConfig ?? {};\n${tokens}`;
}

/**
 * Generates every virtual module the framework runs on. Droplets are
 * discovered from the filesystem, so adding a folder is the only step needed
 * to register one.
 */
export function virtualModulesPlugin(state: PluginState): Plugin {
  let command: "build" | "serve" = "build";
  // The client modules' dev parts (`update` for a load edit, the HMR
  // fallback): `vite dev`, and builds Vite does not call production
  // (`import.meta.env.DEV`).
  let devHooks = false;
  let cached: Promise<DropletEntry[]> | null = null;

  // During `build` the filesystem is fixed, so one scan is enough. In `serve`
  // the module is only re-loaded after an invalidation, which is exactly when
  // the droplet list may have changed — so rescan then.
  const getEntries = (): Promise<DropletEntry[]> => {
    if (command === "serve" || !cached) {
      cached = discoverDroplets({ dropletsRoot: state.dropletsRoot, renderers: state.renderers, dev: command === "serve" });
    }
    return cached;
  };

  const findFile = async (candidates: string[]): Promise<string | null> => {
    for (const file of candidates) {
      if (await fileExists({ path: resolve(state.root, file) })) return `/${file}`;
    }
    return null;
  };

  return {
    name: "droplets:virtual",
    sharedDuringBuild: true,

    configResolved(resolvedConfig) {
      command = resolvedConfig.command;
      devHooks = resolvedConfig.command === "serve" || !resolvedConfig.isProduction;
    },

    resolveId(id, importer) {
      if (id === VIRTUAL_DROPLETS) return RESOLVED_VIRTUAL_DROPLETS;
      if (id === VIRTUAL_DROPLETS_DEV) return RESOLVED_DROPLETS_DEV;
      if (id === VIRTUAL_ENV) return RESOLVED_ENV;
      if (
        SERVER_ONLY.has(id) &&
        (this.environment.config.consumer === "client" || (importer && !mayImportServerOnly({ root: state.root, importer })))
      ) {
        this.error(
          `${id} can only be imported by server files: names with .server. in them (+droplet.server.ts, hooks.server.ts, *.server.*), +server.* routes or files under a server/ folder${
            importer ? `; imported by ${importer}` : ""
          }`,
        );
      }
      if (id === VIRTUAL_SERVER) return serverModulePath;
      if (id === VIRTUAL_ENV_PUBLIC) return RESOLVED_ENV_PUBLIC;
      if (id === VIRTUAL_ENV_PRIVATE) return RESOLVED_ENV_PRIVATE;
      if (id === VIRTUAL_DROP) return RESOLVED_DROP;
      if (id === VIRTUAL_FORM) return RESOLVED_FORM;
      if (id === VIRTUAL_CSS) return RESOLVED_CSS;
      if (id === VIRTUAL_CSS_FILE) return RESOLVED_CSS_FILE;
      if (id === VIRTUAL_CONFIG) return RESOLVED_CONFIG;
      // These resolve to real files, so Vite bundles them like any import.
      if (id === VIRTUAL_SSR) return entryServerPath;
      if (id === VIRTUAL_MANIFEST) return resolve(state.outDir, "client/droplets.json");
      if (id === LOADER_URL) return RESOLVED_DROPS_CLIENT;
      if (id.startsWith(VIRTUAL_CLIENT)) return resolved({ id });
      return null;
    },

    async load(id) {
      if (id === RESOLVED_VIRTUAL_DROPLETS) {
        const entries = await getEntries();
        if (this.environment.config.consumer !== "server") {
          return buildClientCode({
            entries,
            buildHash: state.buildHash,
            elementName: state.config.element,
            isBuilding: command === "build",
            clientHooksFile: await findFile(CLIENT_HOOKS_FILES),
          });
        }
        return buildServerCode({
          entries,
          globRoot: state.globRoot,
          apiRoutes: await discoverApiRoutes({ apiRoot: state.apiRoot }),
          apiGlobRoot: state.apiGlobRoot,
          hooksFile: await findFile(HOOKS_FILES),
          importMapFile: await findFile(IMPORTMAP_FILES),
          renderers: state.renderers,
          publicEnvNames: dynamicPublicNames(state.env),
          tokenNonce: isFixed({ state, isBuilding: command === "build" }) ? undefined : state.tokenNonce,
        });
      }

      if (id === RESOLVED_DROPLETS_DEV) {
        return buildClientDevCode({
          strategy: state.dev.strategy,
          injectTool: state.dev.injectTool,
          toolUrl: state.devToolUrl,
        });
      }

      if (id === RESOLVED_ENV) {
        return [
          "export const browser = !import.meta.env.SSR;",
          "export const dev = import.meta.env.DEV;",
          "/** True while `vite build` prerenders: there is no real request. */",
          'export const building = import.meta.env.SSR && globalThis[Symbol.for("droplets.building")] === true;',
          "",
        ].join("\n");
      }

      if (id === RESOLVED_ENV_PUBLIC) {
        return buildPublicEnvCode({
          env: state.env,
          target:
            this.environment.config.consumer === "client"
              ? { browser: true, serverKey: serverKey(state.config.element, state.buildHash) }
              : { browser: false, envStorePath },
        });
      }
      if (id === RESOLVED_DROP) {
        return this.environment.config.consumer === "client"
          ? buildDropClientCode({ key: serverKey(state.config.element, state.buildHash) })
          : buildDropServerCode({
              requestStore: requestStorePath,
              location: bundleLocation({ state, isBuilding: command === "build" }),
              isFixed: command === "build" && state.config.location !== undefined,
            });
      }
      if (id === RESOLVED_FORM) {
        return this.environment.config.consumer === "client"
          ? buildFormClientCode({ key: serverKey(state.config.element, state.buildHash), formModule: formModulePath })
          : buildFormServerCode({
              requestStore: requestStorePath,
              formModule: formModulePath,
              location: bundleLocation({ state, isBuilding: command === "build" }),
            });
      }
      if (id === RESOLVED_ENV_PRIVATE) return buildPrivateEnvCode({ env: state.env, envStorePath });

      if (id === RESOLVED_CSS) {
        return state.css.path ? `import ${JSON.stringify(state.css.path)};\n` : `import ${JSON.stringify(VIRTUAL_CSS_FILE)};\n`;
      }

      // No project stylesheet: with Tailwind, still emit it so utility
      // classes work. Without scoping, preflight is left out: this sheet
      // lands in host pages, and a global reset would restyle them.
      if (id === RESOLVED_CSS_FILE) {
        if (!tailwindActive(state)) return "";
        return state.css.scoped && state.css.twPreflight ? TAILWIND_FULL : TAILWIND_WITHOUT_PREFLIGHT;
      }

      if (id === RESOLVED_CONFIG) {
        return buildConfigCode({
          configPath: state.configPath,
          hostTokensModule: isFixed({ state, isBuilding: command === "build" }) ? undefined : hostTokensModulePath,
        });
      }

      if (id === RESOLVED_DROPS_CLIENT) {
        // `/index.js` under `vite dev`: Vite serves it, so where it was
        // loaded from and the public runtime variables travel here, as the
        // built server puts them in its stub. A dynamic import, like the
        // stub's: a static one would run the entry before them.
        const key = serverKey(state.config.element, state.buildHash);
        const names = dynamicPublicNames(state.env);
        const env = Object.fromEntries(names.map((name) => [name, state.env.values[name]]));
        return (
          locationScript(key) +
          (names.length > 0 ? publicEnvScript(key, env) : "") +
          `import(${JSON.stringify(toViteFsPath({ filePath: state.entryClientPath }))});\n`
        );
      }

      if (id.startsWith(RESOLVED_CLIENT_PREFIX)) {
        const name = parseClientName({ id });
        if (!name) return null;
        const entry = (await getEntries()).find((e) => e.name === name);
        if (!entry) return null;
        return createClientModuleCode({ globRoot: state.globRoot, entry, renderers: state.renderers, isDev: devHooks });
      }

      return null;
    },
  };
}
