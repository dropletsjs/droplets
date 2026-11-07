import type { Plugin } from "vite";
import { resolve } from "node:path";
import { discoverApiRoutes, type ApiRouteEntry } from "../core/api.ts";
import { discoverDroplets, type DropletEntry } from "../core/discover.ts";
import { buildPrivateEnvCode, buildPublicEnvCode, dynamicPublicNames } from "../core/env.ts";
import { fileExists } from "../core/fs.ts";
import {
  clientInitModulePath,
  enhanceModulePath,
  entryServerPath,
  envStorePath,
  formModulePath,
  loadModulePath,
  propsModulePath,
  requestStorePath,
  serverModulePath,
  toViteFsPath,
} from "../core/paths.ts";
import type { DevStrategy } from "../core/config.ts";
import { sharingRenderers, type DropletRenderer } from "../renderer.ts";
import { isScriptDroplet } from "../script/index.ts";
import { tailwindActive } from "./css.ts";
import { isServerPath, projectPath } from "./server-only.ts";
import { componentSpecifier } from "./frameworks.ts";
import { locationScript, publicEnvScript, serverKey } from "../runtime/servers.ts";
import { CLIENT_HOOKS_FILES, HOOKS_FILES, IMPORTMAP_FILES, rendererNamed, type PluginState } from "./state.ts";

/** Registry of droplets. Resolves to different code per environment. */
export const VIRTUAL_DROPLETS = "virtual:droplets";
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
export function mayImportServerOnly(root: string, importer: string): boolean {
  const rel = projectPath(root, importer);
  return rel === null || isServerPath(rel);
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
export const TAILWIND_WITHOUT_PREFLIGHT =
  '@import "tailwindcss/theme" layer(theme);\n@import "tailwindcss/utilities" layer(utilities);\n';
/** With scoping, the reset is confined to the element and becomes the droplets' base. */
export const TAILWIND_FULL = '@import "tailwindcss";\n';
/**
 * Where the client registry leaves room for the droplets' stylesheets. They
 * are only known once the client build is written; `vite build` fills it in.
 */
export const STYLES_PLACEHOLDER = "__DROPLETS_STYLES__";
/** The loader's public URL; resolved so Vite can process it in dev pages. */
const LOADER_URL = "/index.js";

/** Vite's convention: resolved virtual ids are prefixed with a NUL byte. */
const resolved = (id: string) => `\0${id}`;

export const RESOLVED_VIRTUAL_DROPLETS = resolved(VIRTUAL_DROPLETS);

const RESOLVED_ENV = resolved(VIRTUAL_ENV);
const RESOLVED_ENV_PUBLIC = resolved(VIRTUAL_ENV_PUBLIC);
const RESOLVED_ENV_PRIVATE = resolved(VIRTUAL_ENV_PRIVATE);
const RESOLVED_DROP = resolved(VIRTUAL_DROP);
const RESOLVED_FORM = resolved(VIRTUAL_FORM);
const RESOLVED_CSS = resolved(VIRTUAL_CSS);
const RESOLVED_CSS_FILE = resolved(VIRTUAL_CSS_FILE);
const RESOLVED_CONFIG = resolved(VIRTUAL_CONFIG);
const RESOLVED_DROPS_CLIENT = resolved("droplets:loader");
const RESOLVED_CLIENT_PREFIX = resolved(VIRTUAL_CLIENT);

export function clientEntryId(folderName: string): string {
  return `${VIRTUAL_CLIENT}?name=${encodeURIComponent(folderName)}`;
}

export function parseClientName(id: string): string | null {
  const queryIndex = id.indexOf("?");
  if (queryIndex === -1) return null;
  const name = new URLSearchParams(id.slice(queryIndex + 1)).get("name");
  return name?.trim() ? name.trim() : null;
}

/**
 * The server registry: static imports so the bundler can see the whole graph,
 * with load functions wrapped in thunks so they stay lazy per request.
 */
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
};

/** An absolute module path as an import specifier Vite resolves in any environment. */
function modulePath(file: string): string {
  return JSON.stringify(file.replace(/\\/g, "/"));
}

/**
 * One import per renderer module actually used, named `renderer_<n>`.
 * Returns the import lines and a lookup from renderer name to variable.
 */
function rendererImports(
  entries: DropletEntry[],
  renderers: DropletRenderer[],
  pick: (renderer: DropletRenderer) => string,
): { imports: string[]; variable: (name: string) => string } {
  const imports: string[] = [];
  const variables = new Map<string, string>();
  const used = new Set<string>();
  for (const entry of entries) {
    used.add(entry.renderer);
  }
  for (const name of [...used].sort()) {
    const renderer = rendererNamed({ renderers }, name);
    const variable = `renderer_${variables.size}`;
    variables.set(name, variable);
    imports.push(`import * as ${variable} from ${modulePath(pick(renderer))};`);
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

export function buildServerCode(
  entries: DropletEntry[],
  globRoot: string,
  extras: ServerCodeExtras = {},
): string {
  const members: string[] = [];
  const routes: string[] = [];
  const renderers = rendererImports(entries, extras.renderers ?? [], (r) => r.server);
  const imports: string[] = [...renderers.imports];
  const shared = sharingRenderers(extras.renderers ?? []);
  const component = (path: string, renderer: string) => componentSpecifier(path, renderer, shared);

  (extras.apiRoutes ?? []).forEach((route, index) => {
    const variable = `api_${index}`;
    imports.push(
      `import * as ${variable} from ${JSON.stringify(`${extras.apiGlobRoot ?? "/src/api"}/${route.file}`)};`,
    );
    routes.push(
      `  { id: ${JSON.stringify(route.id)}, segments: ${JSON.stringify(route.segments)}, module: ${variable} },`,
    );
  });

  if (extras.hooksFile) {
    imports.push(`import * as hooks from ${JSON.stringify(extras.hooksFile)};`);
  }
  if (extras.importMapFile) {
    imports.push(`import * as importMapModule from ${JSON.stringify(extras.importMapFile)};`);
  }

  entries.forEach((entry, index) => {
    const base = `${globRoot}/${entry.name}`;
    const componentVar = `component_${index}`;
    const loadVar = entry.hasLoad ? `load_${index}` : null;
    const serverVar = entry.hasServerLoad ? `serverLoad_${index}` : null;
    const errorVar = entry.hasError && entry.errorFile ? `error_${index}` : null;
    if (errorVar) {
      imports.push(
        `import * as ${errorVar} from ${JSON.stringify(component(`${base}/${entry.errorFile}`, entry.renderer))};`,
      );
    }

    if (isScriptDroplet(entry)) {
      // Browser code only, never evaluated on the server: its renderer renders nothing.
      imports.push(`const ${componentVar} = Object.freeze({});`);
    } else {
      imports.push(
        `import * as ${componentVar} from ${JSON.stringify(component(`${base}/${entry.file}`, entry.renderer))};`,
      );
    }
    if (loadVar) {
      imports.push(
        `import * as ${loadVar} from ${JSON.stringify(`${base}/+droplet.ts`)};`,
      );
    }
    if (serverVar) {
      imports.push(
        `import * as ${serverVar} from ${JSON.stringify(`${base}/+droplet.server.ts`)};`,
      );
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
        `    serverLoad: ${
          serverVar ? `() => Promise.resolve(${serverVar})` : "undefined"
        },`,
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
    extras.hooksFile ? "export { hooks };" : "export const hooks = {};",
    extras.importMapFile ? "export { importMapModule };" : "export const importMapModule = {};",
    `export const publicEnvNames = ${JSON.stringify(extras.publicEnvNames ?? [])};`,
    "",
  ].join("\n");
}

/** `base` + `path`, with exactly one slash between them. */
const JOIN = `const join = (base, path) => \`\${base.replace(/\\/+$/, "")}/\${String(path).replace(/^\\/+/, "")}\`;`;

/**
 * `$droplets/drop` in the browser: where the page loads this build's
 * droplets from, as `/index.js` recorded it from its own URL; the bundle's
 * own origin without it.
 */
export function buildDropClientCode(key: string): string {
  return [
    `const origin = () => globalThis[Symbol.for("droplets.servers")]?.[${JSON.stringify(key)}]?.origin ?? new URL(import.meta.url).origin;`,
    JOIN,
    "export const droplet = Object.freeze({",
    "  get origin() { return origin(); },",
    "  url(path) { return join(origin(), path); },",
    "});",
    "export default droplet;",
    "",
  ].join("\n");
}

/** `$droplets/drop` on the server: the current request's public origin, `""` outside a request. */
export function buildDropServerCode(requestStore: string): string {
  return [
    `import { requestInfo } from ${JSON.stringify(requestStore)};`,
    "const origin = () => requestInfo()?.origin ?? \"\";",
    JOIN,
    "export const droplet = Object.freeze({",
    "  get origin() { return origin(); },",
    "  url(path) { return origin() ? join(origin(), path) : `/${String(path).replace(/^\\/+/, \"\")}`; },",
    "});",
    "export default droplet;",
    "",
  ].join("\n");
}

/** What `actionUrl()` of `$droplets/form` says outside a render, without `{ droplet }`. */
const NO_RENDER =
  "actionUrl() of $droplets/form knows the droplet only while one renders: call it as the component sets up (React, Preact and Hono JSX: useState(() => actionUrl(...))), or pass { droplet }";

/**
 * `actionUrl()` of `$droplets/form`, shared by both variants: the droplet
 * and its props from the render in progress unless given; and
 * `enhanceDropletForm`, which only ever runs in the browser.
 */
const ACTION_URL = (current: string, location: string, page: string, enhanceModule: string) => [
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

/**
 * `$droplets/form` in the browser: the render in progress, on the location
 * `/index.js` recorded (as `$droplets/drop`), for the page in
 * `window.location`.
 */
export function buildFormClientCode(key: string, formModule: string, enhanceModule: string = enhanceModulePath): string {
  return [
    `import { actionHref, browserPage, currentRender } from ${JSON.stringify(formModule)};`,
    `const origin = () => globalThis[Symbol.for("droplets.servers")]?.[${JSON.stringify(key)}]?.origin ?? new URL(import.meta.url).origin;`,
    ACTION_URL("currentRender()", "render?.location ?? origin()", "browserPage()", enhanceModule),
  ].join("\n");
}

/**
 * `$droplets/form` on the server: the droplet the current request renders,
 * on its public location (a trusted `x-host`, else the request's origin;
 * a token at build), for the page of `event.host` (tokens at build).
 */
export function buildFormServerCode(requestStore: string, formModule: string, enhanceModule: string = enhanceModulePath): string {
  return [
    `import { requestInfo } from ${JSON.stringify(requestStore)};`,
    `import { actionHref } from ${JSON.stringify(formModule)};`,
    ACTION_URL("requestInfo()?.render", "requestInfo()?.origin ?? \"\"", "requestInfo()?.page", enhanceModule),
  ].join("\n");
}

/** What `index.js` reads under `vite dev` only: see `DropletsConfig["dev"]`. */
export type ClientDevOptions = { strategy: DevStrategy; injectTool: boolean; toolUrl: string | null };

/**
 * `init` of `src/hooks.client.ts`, called as the registry evaluates: the
 * entry client imports the registry first, so `init` has run before the
 * entry's body defines the element. Never awaited. Nothing at all without
 * the file.
 */
export function clientInitCode(clientHooksFile: string, initModule: string = clientInitModulePath): string {
  return [
    `import * as clientHooks from ${JSON.stringify(clientHooksFile)};`,
    `import { runClientInit } from ${modulePath(initModule)};`,
    `runClientInit(clientHooks, ${JSON.stringify(clientHooksFile.replace(/^\//, ""))});`,
    "",
  ].join("\n");
}

/**
 * The client registry: ids and flags only. Components are never imported
 * here — each droplet is its own bundle, fetched on demand. With
 * `src/hooks.client.ts` (`clientHooksFile`, root-relative), its `init` too.
 */
export function buildClientCode(
  entries: DropletEntry[],
  buildHash: string,
  elementName = "djs-droplet",
  dev: ClientDevOptions = { strategy: "remount", injectTool: false, toolUrl: null },
  building = false,
  clientHooksFile: string | null = null,
): string {
  const flag = (e: DropletEntry) => `  ${JSON.stringify(e.id)}: true,`;
  const ids = entries.map(flag);
  // `true`, `"visible"` or `"interactive"`: when the element hydrates.
  const hydrating = entries
    .filter((e) => e.hydrate !== false)
    .map((e) => `  ${JSON.stringify(e.id)}: ${JSON.stringify(e.hydrate)},`);
  // Only these have server data to fetch from `_data`.
  const serverLoading = entries.filter((e) => e.hasServerLoad).map(flag);

  return [
    // Dev only: Vite injects the shared stylesheet and keeps it updated. A
    // build lists it first among each droplet's stylesheets instead.
    ...(building ? [] : [`import ${JSON.stringify(VIRTUAL_CSS)};`]),
    "const droplets = {};",
    "export default droplets;",
    `export const buildHash = ${JSON.stringify(buildHash)};`,
    `export const elementName = ${JSON.stringify(elementName)};`,
    // Read only under `vite dev`; a build drops the code that reads them.
    `export const devStrategy = ${JSON.stringify(dev.strategy)};`,
    `export const devInjectTool = ${JSON.stringify(dev.injectTool)};`,
    `export const devToolUrl = ${JSON.stringify(dev.toolUrl)};`,
    "export const dropletsById = {",
    ...ids,
    "};",
    "export const dropletsHydrateById = {",
    ...hydrating,
    "};",
    "export const dropletsServerLoadById = {",
    ...serverLoading,
    "};",
    // Stylesheets per droplet, relative to the server: filled in once the
    // build is written. In dev, component styles come with the JavaScript.
    building
      ? `export const dropletsStylesById = JSON.parse(${JSON.stringify(STYLES_PLACEHOLDER)});`
      : "export const dropletsStylesById = {};",
    ...(clientHooksFile ? [clientInitCode(clientHooksFile)] : [""]),
  ].join("\n");
}

/** What `createClientModuleCode` needs to know about one droplet. */
export type ClientModuleInput = Pick<
  DropletEntry,
  "id" | "name" | "file" | "renderer" | "hasError" | "errorFile"
>;

/**
 * A single droplet's browser entry: the props schema, `load` and
 * `handleError` of `+droplet.ts`, the component with its renderer, and the
 * error page, in the same framework.
 *
 * Exports, as the custom element (`entry-client`) calls them:
 * `default(target, data, host, info)` mounts or hydrates the droplet,
 * `renderError(target, error, host, info)` the error page, `unmount(handle)`
 * tears either down. `host` is the children host, `info` carries the
 * server's `renderId`, the server-rendered markers, the `form` a form
 * action's result rendered with, and, for a droplet
 * mounted with `data` still to come, `handleError`: the renderer's error
 * boundary then shows the error page in place of what fails to render.
 */
export function createClientModuleCode(
  globRoot: string,
  entry: ClientModuleInput,
  renderers: DropletRenderer[],
  propsModule: string = propsModulePath,
  loadModule: string = loadModulePath,
  formModule: string = formModulePath,
): string {
  const base = `${globRoot}/${entry.name}`;
  const loadFile = `${base}/+droplet.ts`;
  const id = JSON.stringify(entry.id);
  const renderer = rendererNamed({ renderers }, entry.renderer);
  const withError = entry.hasError && entry.errorFile;
  const shared = sharingRenderers(renderers);

  const imports = [
    ...(renderer.clientSetup ? [`import ${modulePath(renderer.clientSetup)};`] : []),
    `import * as renderer from ${modulePath(renderer.client)};`,
    `import * as component from ${JSON.stringify(componentSpecifier(`${base}/${entry.file}`, entry.renderer, shared))};`,
    ...(withError
      ? [`import * as errorPage from ${JSON.stringify(componentSpecifier(`${base}/${entry.errorFile}`, entry.renderer, shared))};`]
      : ["const errorPage = undefined;"]),
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
  const boundary = kind === "droplet" && !hydrating && errorPage && info?.handleError;
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
    ...(boundary ? { error: { module: errorPage, handle: info.handleError } } : {}),
  };
  // For \`actionUrl()\` of \`$droplets/form\` while the component renders.
  const rendering = { droplet: ${id}, location, props: info?.props };
  const instance = await withRender(rendering, () =>
    hydrating ? renderer.hydrate(module, target, props, context) : renderer.mount(module, target, props, context)
  );
  return { engine: renderer, instance };
}

export default function render(target, data, host, info) {
  // \`form\`, the result of a form action, only when there is one.
  const props = info && info.form !== undefined ? { data, form: info.form } : { data };
  return show(component, "droplet", target, props, host, info);
}

/** Shows the error page; \`null\` when the droplet has none. */
export function renderError(target, error, host, info) {
  return errorPage ? show(errorPage, "error", target, { error }, host, info) : null;
}

export function unmount(handle) {
  return handle?.engine?.unmount(handle.instance);
}
`;
}

/** The production server's view of `droplets.config.ts`. */
export function buildConfigCode(configPath: string | null): string {
  if (!configPath) return "export default {};\n";
  return `import userConfig from ${JSON.stringify(configPath)};\nexport default userConfig ?? {};\n`;
}

/**
 * Generates every virtual module the framework runs on. Droplets are
 * discovered from the filesystem, so adding a folder is the only step needed
 * to register one.
 */
export function virtualModulesPlugin(state: PluginState): Plugin {
  let command: "build" | "serve" = "build";
  let cached: Promise<DropletEntry[]> | null = null;

  // During `build` the filesystem is fixed, so one scan is enough. In `serve`
  // the module is only re-loaded after an invalidation, which is exactly when
  // the droplet list may have changed — so rescan then.
  const getEntries = (): Promise<DropletEntry[]> => {
    if (command === "serve" || !cached) {
      cached = discoverDroplets(state.dropletsRoot, state.renderers, { dev: command === "serve" });
    }
    return cached;
  };

  const findFile = async (candidates: string[]): Promise<string | null> => {
    for (const file of candidates) {
      if (await fileExists(resolve(state.root, file))) return `/${file}`;
    }
    return null;
  };

  return {
    name: "droplets:virtual",
    sharedDuringBuild: true,

    configResolved(resolvedConfig) {
      command = resolvedConfig.command;
    },

    resolveId(id, importer) {
      if (id === VIRTUAL_DROPLETS) return RESOLVED_VIRTUAL_DROPLETS;
      if (id === VIRTUAL_ENV) return RESOLVED_ENV;
      if (
        SERVER_ONLY.has(id) &&
        (this.environment.config.consumer === "client" ||
          (importer && !mayImportServerOnly(state.root, importer)))
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
      if (id.startsWith(VIRTUAL_CLIENT)) return resolved(id);
      return null;
    },

    async load(id) {
      if (id === RESOLVED_VIRTUAL_DROPLETS) {
        const entries = await getEntries();
        if (this.environment.config.consumer !== "server") {
          return buildClientCode(entries, state.buildHash, state.config.element, {
            strategy: state.config.dev.strategy,
            injectTool: state.config.dev.injectTool,
            toolUrl: state.devToolUrl,
          }, command === "build", await findFile(CLIENT_HOOKS_FILES));
        }
        return buildServerCode(entries, state.globRoot, {
          apiRoutes: await discoverApiRoutes(state.apiRoot),
          apiGlobRoot: state.apiGlobRoot,
          hooksFile: await findFile(HOOKS_FILES),
          importMapFile: await findFile(IMPORTMAP_FILES),
          renderers: state.renderers,
          publicEnvNames: dynamicPublicNames(state.env),
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
        return buildPublicEnvCode(
          state.env,
          this.environment.config.consumer === "client"
            ? { browser: true, serverKey: serverKey(state.config.element, state.buildHash) }
            : { browser: false, envStorePath },
        );
      }
      if (id === RESOLVED_DROP) {
        return this.environment.config.consumer === "client"
          ? buildDropClientCode(serverKey(state.config.element, state.buildHash))
          : buildDropServerCode(requestStorePath);
      }
      if (id === RESOLVED_FORM) {
        return this.environment.config.consumer === "client"
          ? buildFormClientCode(serverKey(state.config.element, state.buildHash), formModulePath)
          : buildFormServerCode(requestStorePath, formModulePath);
      }
      if (id === RESOLVED_ENV_PRIVATE) return buildPrivateEnvCode(state.env, envStorePath);

      if (id === RESOLVED_CSS) {
        return state.css.path
          ? `import ${JSON.stringify(state.css.path)};\n`
          : `import ${JSON.stringify(VIRTUAL_CSS_FILE)};\n`;
      }

      // No project stylesheet: with Tailwind, still emit it so utility
      // classes work. Without scoping, preflight is left out: this sheet
      // lands in host pages, and a global reset would restyle them.
      if (id === RESOLVED_CSS_FILE) {
        if (!tailwindActive(state)) return "";
        return state.css.scoped && state.css.twPreflight ? TAILWIND_FULL : TAILWIND_WITHOUT_PREFLIGHT;
      }

      if (id === RESOLVED_CONFIG) {
        return buildConfigCode(state.configPath);
      }

      if (id === RESOLVED_DROPS_CLIENT) {
        // `/index.js` under `vite dev`: Vite serves it, so where it was
        // loaded from and the public runtime variables travel here, as the
        // built server puts them in its stub. A dynamic import, like the
        // stub's: a static one would run the entry before them.
        const key = serverKey(state.config.element, state.buildHash);
        const names = dynamicPublicNames(state.env);
        const env = Object.fromEntries(names.map((name) => [name, state.env.values[name]]));
        return locationScript(key) + (names.length > 0 ? publicEnvScript(key, env) : "") +
          `import(${JSON.stringify(toViteFsPath(state.entryClientPath))});\n`;
      }

      if (id.startsWith(RESOLVED_CLIENT_PREFIX)) {
        const name = parseClientName(id);
        if (!name) return null;
        const entry = (await getEntries()).find((e) => e.name === name);
        if (!entry) return null;
        return createClientModuleCode(state.globRoot, entry, state.renderers);
      }

      return null;
    },
  };
}
