/**
 * The messages about the project itself, which `vite dev` and `vite build`
 * check: `droplets.config.ts`, `src/env.ts`, the renderers' options, the
 * droplet folders and their flags, the `+server.ts` routes, and the worker
 * threads that load the project's code.
 *
 * @module
 */
import type { AnyMessage, ErrorPages } from "./format.ts";

const TIMEOUT_RANGE = "use 0 (wait for no promise) up to 2147483647 ms, or Infinity (wait forever)";

export const ERROR_FORMAT_INVALID = {
  code: "error-format-invalid",
  level: "error",
  what: ({ value }: { value: string }) => `errorFormat is ${value}`,
  fix: 'write "agent" (labelled lines, the default) or "human" (one line) in droplets.config.ts',
} satisfies AnyMessage;

export const FOLDER_OUTSIDE_PROJECT = {
  code: "folder-outside-project",
  level: "error",
  what: ({ option, folder }: { option: string; folder: string }) => `${option} must be a folder inside the project, got ${folder}`,
  fix: 'write a path under the project root, such as "src/droplets"',
} satisfies AnyMessage;

export const PATH_RESERVED = {
  code: "path-reserved",
  level: "error",
  what: ({ option, example, path }: { option: string; example: string; path: string }) =>
    `${option} must be a path such as "${example}", outside /, /index.js, /env.js, /index.css, /droplets/, /assets/ and /api/, got "${path}"`,
  fix: "start it with / and give it a path of its own, without ?, # or spaces",
} satisfies AnyMessage;

export const HEALTH_IMPORT_MAP_SAME_PATH = {
  code: "health-import-map-same-path",
  level: "error",
  what: ({ health, importMap }: { health: string; importMap: string }) =>
    `health (${health}) and importMap (${importMap}, ${importMap}.js) answer the same path`,
  fix: "move one of them",
} satisfies AnyMessage;

export const TRUSTED_ORIGINS_NOT_LIST = {
  code: "trusted-origins-not-list",
  level: "error",
  what: 'trustedOrigins must be a list of origins such as ["https://shop.example"]',
  fix: "write trustedOrigins as an array of origins in droplets.config.ts",
} satisfies AnyMessage;

export const TRUSTED_ORIGIN_INVALID = {
  code: "trusted-origin-invalid",
  level: "error",
  what: ({ origin }: { origin: string }) => `trustedOrigins takes origins such as "https://shop.example" (no path), got ${origin}`,
  fix: 'write each entry as scheme://host[:port], or "*" to trust any',
} satisfies AnyMessage;

export const LOCATION_INVALID = {
  code: "location-invalid",
  level: "error",
  what: ({ value }: { value: string }) =>
    `location takes this server's public URL, an origin with an optional path prefix such as "https://droplets.example" or "https://shop.example/mfe", got ${value}`,
  fix: "write the URL the browser reaches this server at, without query, hash or credentials, or leave location out to compute it per request",
} satisfies AnyMessage;

export const HOST_INVALID = {
  code: "host-invalid",
  level: "error",
  what: ({ value }: { value: string }) =>
    `host takes the origin of the page the droplets render on, such as "https://shop.example" (no path), got ${value}`,
  fix: "write the page's origin, scheme://host[:port], or leave host out to read it per request",
} satisfies AnyMessage;

export const CACHE_CONTROL_INVALID = {
  code: "cache-control-invalid",
  level: "error",
  what: ({ option, fallback, value }: { option: string; fallback: string; value: string }) =>
    `${option} must be a Cache-Control value such as "${fallback}", or false, got ${value}`,
  fix: "write one line of Cache-Control directives, or false to send none",
} satisfies AnyMessage;

export const LIMIT_INVALID = {
  code: "limit-invalid",
  level: "error",
  what: ({ name, value }: { name: string; value: string }) => `limits.${name} must be a positive number of bytes, got ${value}`,
  fix: "write a number above 0, or Infinity to lift the limit",
} satisfies AnyMessage;

export const RENDER_NOT_OBJECT = {
  code: "render-not-object",
  level: "error",
  what: ({ value }: { value: string }) => `render must be an object such as { timeout: 10000 }, got ${value}`,
  fix: "write render as an object, or leave it out for the defaults",
} satisfies AnyMessage;

export const RENDER_TIMEOUT_NOT_NUMBER = {
  code: "render-timeout-not-number",
  level: "error",
  what: ({ value }: { value: string }) => `render.timeout must be a number of milliseconds, got ${value}`,
  fix: TIMEOUT_RANGE,
} satisfies AnyMessage;

export const RENDER_TIMEOUT_NEGATIVE = {
  code: "render-timeout-negative",
  level: "error",
  what: ({ value }: { value: string }) => `render.timeout cannot be negative, got ${value}`,
  fix: TIMEOUT_RANGE,
} satisfies AnyMessage;

export const RENDER_TIMEOUT_NOT_WHOLE = {
  code: "render-timeout-not-whole",
  level: "error",
  what: ({ value }: { value: string }) => `render.timeout must be a whole number of milliseconds, got ${value}`,
  fix: TIMEOUT_RANGE,
} satisfies AnyMessage;

export const RENDER_TIMEOUT_TOO_LONG = {
  code: "render-timeout-too-long",
  level: "error",
  what: ({ value }: { value: string }) => `render.timeout is longer than a timer can wait, got ${value}`,
  fix: TIMEOUT_RANGE,
} satisfies AnyMessage;

export const ELEMENT_NAME_INVALID = {
  code: "element-name-invalid",
  level: "error",
  what: ({ element }: { element: string }) => `"${element}" is not a valid custom element name`,
  fix: 'use lowercase letters and a hyphen, e.g. "my-droplet"',
} satisfies AnyMessage;

export const DEV_STRATEGY_INVALID = {
  code: "dev-strategy-invalid",
  level: "error",
  what: ({ value }: { value: string; strategies: string }) => `dev.strategy is "${value}"`,
  fix: ({ strategies }: { value: string; strategies: string }) => `use ${strategies}`,
} satisfies AnyMessage;

export const CONFIG_FILE_NOT_FOUND = {
  code: "config-file-not-found",
  level: "error",
  what: ({ path }: { path: string }) => `config file not found at ${path}`,
  fix: "point configFile at an existing droplets.config.ts, or leave the option out",
} satisfies AnyMessage;

export const PACKAGE_ROOT_NOT_FOUND = {
  code: "package-root-not-found",
  level: "error",
  what: ({ start }: { start: string }) => `could not locate the droplets package root from ${start}`,
  fix: "reinstall @dropletsjs/droplets: its package.json is missing",
} satisfies AnyMessage;

export const ENV_VARIABLES_MISSING = {
  code: "env-variables-missing",
  level: "error",
  what: "this file must export `variables`",
  fix: "export const variables = defineEnvVars({ ... })",
} satisfies AnyMessage;

export const ENV_NAME_INVALID = {
  code: "env-name-invalid",
  level: "error",
  what: ({ name }: { name: string }) => `"${name}" is not a valid environment variable name`,
  fix: "use letters, digits and _, starting with a letter or _",
} satisfies AnyMessage;

export const ENV_OPTIONS_NOT_OBJECT = {
  code: "env-options-not-object",
  level: "error",
  what: ({ name }: { name: string }) => `${name} must be declared with an options object`,
  fix: ({ name }: { name: string }) => `declare it as ${name}: {}`,
} satisfies AnyMessage;

export const RENDERER_NAME_MISSING = {
  code: "renderer-name-missing",
  level: "error",
  what: "every renderer needs a name",
  fix: "give the renderer a name, as the first-party factories do",
} satisfies AnyMessage;

export const RENDERER_NAME_RESERVED = {
  code: "renderer-name-reserved",
  level: "error",
  what: '"script" is the built-in renderer of +droplet.script.ts',
  fix: "name yours otherwise",
} satisfies AnyMessage;

export const RENDERER_NAME_DUPLICATE = {
  code: "renderer-name-duplicate",
  level: "error",
  what: ({ name }: { name: string }) => `two renderers are named "${name}"`,
  fix: "list each renderer once in renderers, or give each its own name",
} satisfies AnyMessage;

export const RENDERER_EXTENSIONS_MISSING = {
  code: "renderer-extensions-missing",
  level: "error",
  what: ({ name }: { name: string }) => `renderer "${name}" lists no extensions`,
  fix: 'list the file endings it handles, such as ".svelte"',
} satisfies AnyMessage;

export const RENDERER_EXTENSION_INVALID = {
  code: "renderer-extension-invalid",
  level: "error",
  what: ({ name, extension }: { name: string; extension: string }) => `renderer "${name}": extension "${extension}" must start with a dot`,
  fix: 'write it as ".ext"',
} satisfies AnyMessage;

export const RENDERER_EXTENSION_RESERVED = {
  code: "renderer-extension-reserved",
  level: "error",
  what: ({ name, extension, owner }: { name: string; extension: string; owner: string }) =>
    `renderer "${name}" cannot claim "${extension}"; +droplet${extension} is ${owner}`,
  fix: ({ extension }: { name: string; extension: string; owner: string }) => `remove "${extension}" from its extensions`,
} satisfies AnyMessage;

export const RENDERER_EXTENSION_SHARED = {
  code: "renderer-extension-shared",
  level: "error",
  what: ({ other, name, extension, unpackaged }: { other: string; name: string; extension: string; unpackaged: string }) =>
    `renderers "${other}" and "${name}" both claim ${extension}, and "${unpackaged}" lists no packages to tell its components apart`,
  fix: "keep one of them",
} satisfies AnyMessage;

export const RENDERER_PACKAGES_MISSING = {
  code: "renderer-packages-missing",
  level: "error",
  what: ({ name }: { name: string }) => `renderer "${name}" shares an extension and lists no packages`,
  fix: "list the packages its components import in packages, or keep only one renderer for the extension",
} satisfies AnyMessage;

export const RENDERER_MODULE_MISSING = {
  code: "renderer-module-missing",
  level: "error",
  what: ({ name, field }: { name: string; field: string }) => `renderer "${name}" needs a ${field} module path`,
  fix: ({ field }: { name: string; field: string }) => `set ${field} to the absolute path of its ${field} module`,
} satisfies AnyMessage;

export const COMPONENT_RENDERER_AMBIGUOUS = {
  code: "component-renderer-ambiguous",
  level: "error",
  what: ({ names, all, imports }: { names: string; all: string; imports: string; hints: string }) =>
    `${names} ${all} handle this file and it ${imports}`,
  fix: ({ hints }: { names: string; all: string; imports: string; hints: string }) =>
    `import from ${hints}, or add a /** @jsxImportSource <package> */ comment`,
} satisfies AnyMessage;

export const COMPONENT_RENDERER_MISSING = {
  code: "component-renderer-missing",
  level: "error",
  what: ({ extension }: { extension: string; hint: string }) => `no renderer for ${extension}`,
  fix: ({ hint }: { extension: string; hint: string }) => hint,
} satisfies AnyMessage;

export const COMPONENT_FILES_DUPLICATE = {
  code: "component-files-duplicate",
  level: "error",
  what: ({ folder, count, kind, files }: { folder: string; count: number; kind: string; files: string }) =>
    `${folder}/ has ${count} ${kind} components (${files})`,
  fix: "keep one",
} satisfies AnyMessage;

export const COMPONENT_NOT_RECOGNISED = {
  code: "component-not-recognised",
  level: "error",
  what: ({ kind }: { kind: string }) => `this file is not a ${kind} component`,
  fix: "name it +droplet.<ext> or +error.<ext>, with an extension a configured renderer handles",
} satisfies AnyMessage;

export const DROPLET_FOLDERS_MISNAMED = {
  code: "droplet-folders-misnamed",
  level: "warning",
  what: ({ folders }: { folders: string }) =>
    `these droplet folders do not match the naming convention (lowercase kebab-case) and are ignored: ${folders}`,
  fix: "rename each folder in lowercase kebab-case, such as hello-world: the folder's name is the droplet's id",
} satisfies AnyMessage;

export const ERROR_PAGE_OTHER_FRAMEWORK = {
  code: "error-page-other-framework",
  level: "warning",
  what: ({ framework }: { framework: string }) => `this error page is not a ${framework} component like the droplet; ignored`,
  fix: "write the error page in the droplet's framework",
} satisfies AnyMessage;

export const ERROR_PAGE_FLAGS_IGNORED = {
  code: "error-page-flags-ignored",
  level: "warning",
  what: ({ flags }: { flags: string }) => `the error page declares ${flags}; ignored`,
  fix: "remove them: +error.* follows the droplet's ssr, hydrate and prerender",
} satisfies AnyMessage;

export const SCRIPT_ERROR_PAGE_IGNORED = {
  code: "script-error-page-ignored",
  level: "warning",
  what: "this error page is ignored: a script droplet has no error page",
  fix: "remove the file: a script droplet renders nothing, on either side",
} satisfies AnyMessage;

export const LOAD_FILE_MISNAMED = {
  code: "load-file-misnamed",
  level: "warning",
  what: "this file is not loaded",
  fix: ({ names }: { names: string }) => `name it ${names}`,
} satisfies AnyMessage;

export const FLAG_NOT_BOOLEAN = {
  code: "flag-not-boolean",
  level: "warning",
  what: ({ name, found }: { name: string; found: string }) =>
    `\`export const ${name}\` must be a literal true or false, found ${found}; ignoring it`,
  fix: ({ name }: { name: string; found: string }) => `write export const ${name} = true or export const ${name} = false`,
} satisfies AnyMessage;

export const HYDRATE_FLAG_INVALID = {
  code: "hydrate-flag-invalid",
  level: "warning",
  what: ({ found }: { found: string }) =>
    `\`export const hydrate\` must be true, false, "visible" or "interactive", found ${found}; ignoring it`,
  fix: "write one of those four literals",
} satisfies AnyMessage;

export const SCRIPT_HYDRATE_LOCKED = {
  code: "script-hydrate-locked",
  level: "warning",
  what: "exports hydrate = true; a script droplet is always hydrated (locked to true)",
  fix: "remove the export",
} satisfies AnyMessage;

export const SCRIPT_FLAG_IGNORED = {
  code: "script-flag-ignored",
  level: "warning",
  what: ({ flag }: { flag: string }) => `exports ${flag}; this is ignored, a script droplet is client only`,
  fix: "remove the export",
} satisfies AnyMessage;

export const ROUTE_SEGMENT_UNSUPPORTED = {
  code: "route-segment-unsupported",
  level: "error",
  what: ({ segment }: { segment: string }) => `unsupported route segment "${segment}"`,
  fix: "use [name] or [...name] (matchers and optional parameters are not supported yet)",
} satisfies AnyMessage;

export const ROUTE_PARAM_DUPLICATE = {
  code: "route-param-duplicate",
  level: "error",
  what: ({ name }: { name: string }) => `parameter "${name}" appears twice`,
  fix: "give each parameter of the path its own name",
} satisfies AnyMessage;

export const ROUTE_REST_NOT_LAST = {
  code: "route-rest-not-last",
  level: "error",
  what: "a [...rest] segment must be the last one",
  fix: "move the [...rest] folder to the end of the path",
} satisfies AnyMessage;

export const ROUTE_CLASH = {
  code: "route-clash",
  level: "error",
  what: ({ first, second, route }: { first: string; second: string; route: string }) => `${first} and ${second} both answer ${route}`,
  fix: "keep one of them: [id] and [slug] at the same place match the same URLs",
} satisfies AnyMessage;

export const ROUTE_FILE_MISNAMED = {
  code: "route-file-misnamed",
  level: "warning",
  what: "this file is not a route",
  fix: ({ names }: { names: string }) => `name it ${names}`,
} satisfies AnyMessage;

export const THREAD_NOT_WORKER = {
  code: "thread-not-worker",
  level: "error",
  what: "answer() runs in a worker thread",
  fix: "call answer() only from the module a worker thread loads",
} satisfies AnyMessage;

export const THREAD_METHOD_UNKNOWN = {
  code: "thread-method-unknown",
  level: "error",
  what: ({ method }: { method: string }) => `the thread has no "${method}"`,
  fix: "call a method the thread's handlers define",
} satisfies AnyMessage;

export const CONFIG_PAGES: ErrorPages = {
  "error-format-invalid": {
    when: "vite dev or vite build loads a droplets.config.ts whose errorFormat is neither of its two values.",
    see: "/guides/configuration/#error-format",
  },
  "folder-outside-project": {
    when: "vite dev or vite build reads a dropletsFolder or apiFolder in droplets.config.ts that climbs out of the project with `..`.",
    see: "/guides/configuration/#options",
  },
  "path-reserved": {
    when: "droplets.config.ts sets health or importMap to something that is not a path, or to a path the framework answers itself.",
    see: "/guides/configuration/#options",
  },
  "health-import-map-same-path": {
    when: "droplets.config.ts gives health and importMap (or importMap's .js twin) the same path.",
    see: "/guides/configuration/#options",
  },
  "trusted-origins-not-list": {
    when: "droplets.config.ts sets trustedOrigins to something other than an array.",
    see: "/guides/configuration/#trusted-origins",
  },
  "trusted-origin-invalid": {
    when: 'An entry of trustedOrigins in droplets.config.ts is neither an origin (scheme, host and port, no path) nor "*".',
    see: "/guides/configuration/#trusted-origins",
  },
  "location-invalid": {
    when: "droplets.config.ts sets location to something other than an http(s) origin with an optional path prefix.",
    see: "/guides/configuration/#the-droplet-location",
  },
  "host-invalid": {
    when: "droplets.config.ts sets host to something other than an http(s) origin.",
    see: "/guides/configuration/#a-fixed-host",
  },
  "cache-control-invalid": {
    when: "droplets.config.ts sets fragmentCacheControl or publicCacheControl to an empty value, a value on several lines, or something that is not a string or false.",
    see: "/guides/configuration/#options",
  },
  "limit-invalid": {
    when: "A value of limits in droplets.config.ts is not a number above 0.",
    see: "/guides/configuration/#options",
  },
  "render-not-object": {
    when: "droplets.config.ts sets render to something other than an object.",
    see: "/guides/errors/#timeouts",
  },
  "render-timeout-not-number": {
    when: "render.timeout in droplets.config.ts is not a number (a string, NaN, null, a boolean).",
    see: "/guides/errors/#timeouts",
  },
  "render-timeout-negative": {
    when: "render.timeout in droplets.config.ts is below 0.",
    see: "/guides/errors/#timeouts",
  },
  "render-timeout-not-whole": {
    when: "render.timeout in droplets.config.ts has a fraction of a millisecond.",
    see: "/guides/errors/#timeouts",
  },
  "render-timeout-too-long": {
    when: "render.timeout in droplets.config.ts is above 2147483647 ms, the longest delay a timer takes, and not Infinity.",
    see: "/guides/errors/#timeouts",
  },
  "element-name-invalid": {
    when: "droplets.config.ts sets element to a name the browser does not take for a custom element.",
    see: "/guides/configuration/#the-element-name",
  },
  "dev-strategy-invalid": {
    when: "vite dev reads a dev.strategy in droplets.config.ts that is not one of the four strategies.",
    see: "/guides/development/#hot-updates",
  },
  "config-file-not-found": {
    when: "The configFile option of droplets() in vite.config names a file that does not exist.",
    see: "/guides/configuration/#plugin-options",
  },
  "package-root-not-found": {
    when: "The plugin starts and cannot find the package.json of @dropletsjs/droplets above its own files: a broken install.",
  },
  "env-variables-missing": {
    when: "vite dev or vite build loads src/env.ts and it exports no `variables` object.",
    see: "/guides/server/#environment-variables",
  },
  "env-name-invalid": {
    when: "A key of the declaration in src/env.ts is not a valid environment variable name.",
    see: "/guides/server/#environment-variables",
  },
  "env-options-not-object": {
    when: "A variable in src/env.ts is declared with something other than an options object.",
    see: "/guides/server/#environment-variables",
  },
  "renderer-name-missing": {
    when: "vite dev or vite build checks the renderers list and one of them has no name.",
    see: "/renderers/#writing-a-renderer",
  },
  "renderer-name-reserved": {
    when: 'A renderer in the renderers list is named "script", the name of the built-in renderer of script droplets.',
    see: "/renderers/#writing-a-renderer",
  },
  "renderer-name-duplicate": {
    when: "Two renderers in the renderers list have the same name, often the same factory called twice.",
    see: "/renderers/#add-a-renderer",
  },
  "renderer-extensions-missing": {
    when: "A renderer in the renderers list declares no file extensions.",
    see: "/renderers/#writing-a-renderer",
  },
  "renderer-extension-invalid": {
    when: "A renderer declares a file extension that does not start with a dot.",
    see: "/renderers/#writing-a-renderer",
  },
  "renderer-extension-reserved": {
    when: "A renderer claims an extension the framework keeps for itself: a load file's (.ts, .js) or a script droplet's (.script.ts, .script.js).",
    see: "/renderers/#writing-a-renderer",
  },
  "renderer-extension-shared": {
    when: "Two renderers claim the same extension and one of them lists no packages, so a component could not be matched to one.",
    see: "/renderers/#which-renderer-a-tsx-file-belongs-to",
  },
  "renderer-packages-missing": {
    when: "A component's extension is shared by several renderers and one of them lists no packages to tell its components apart.",
    see: "/renderers/#which-renderer-a-tsx-file-belongs-to",
  },
  "renderer-module-missing": {
    when: "A renderer in the renderers list has no server or client module path.",
    see: "/renderers/#writing-a-renderer",
  },
  "component-renderer-ambiguous": {
    when: "Discovery finds a component (a .tsx, say) that several configured renderers handle, and its imports match none of them or more than one.",
    see: "/renderers/#which-renderer-a-tsx-file-belongs-to",
  },
  "component-renderer-missing": {
    when: "Discovery finds a +droplet.<ext> or +error.<ext> whose extension no configured renderer handles.",
    see: "/renderers/#add-a-renderer",
  },
  "component-files-duplicate": {
    when: "A droplet folder holds two components (two +droplet.* files, or two +error.* files).",
    see: "/guides/writing-droplets/#structure",
  },
  "component-not-recognised": {
    when: "Discovery takes a file for a component and cannot read its extension.",
    see: "/guides/writing-droplets/#structure",
  },
  "droplet-folders-misnamed": {
    when: "vite dev or vite build finds droplet folders whose names are not lowercase kebab-case; they are left out.",
    see: "/guides/writing-droplets/#structure",
  },
  "error-page-other-framework": {
    when: "vite dev or vite build finds an +error.* written for another framework than the droplet's +droplet.*; the error page is left out.",
    see: "/guides/errors/#errors-handleerror-and-error",
  },
  "error-page-flags-ignored": {
    when: "vite dev or vite build finds ssr, hydrate or prerender exported from an +error.* component.",
    see: "/guides/writing-droplets/#flags",
  },
  "script-error-page-ignored": {
    when: "vite dev or vite build finds an +error.* in the folder of a script droplet (+droplet.script.ts).",
    see: "/guides/writing-droplets/#script-droplets",
  },
  "load-file-misnamed": {
    when: "vite dev or vite build finds a load file (+droplet.*, +droplet.server.*, src/hooks.server.*, src/importmap.server.*) with another extension than .ts or .js; it is not loaded.",
    see: "/guides/writing-droplets/#structure",
  },
  "flag-not-boolean": {
    when: "vite dev or vite build reads ssr or prerender from a component and its value is not a literal true or false.",
    see: "/guides/writing-droplets/#flags",
  },
  "hydrate-flag-invalid": {
    when: "vite dev or vite build reads hydrate from a component and its value is not one of its four literals.",
    see: "/guides/writing-droplets/#flags",
  },
  "script-hydrate-locked": {
    when: "vite dev or vite build reads `export const hydrate = true` from a +droplet.script.ts, once per file.",
    see: "/guides/writing-droplets/#script-droplets",
  },
  "script-flag-ignored": {
    when: "vite dev or vite build reads a flag other than hydrate = true from a +droplet.script.ts, once per file and flag.",
    see: "/guides/writing-droplets/#script-droplets",
  },
  "route-segment-unsupported": {
    when: "vite dev or vite build finds a folder under src/api with brackets that are neither [name] nor [...name].",
    see: "/guides/server/#api-routes",
  },
  "route-param-duplicate": {
    when: "A +server.ts route's path names the same parameter twice.",
    see: "/guides/server/#api-routes",
  },
  "route-rest-not-last": {
    when: "A +server.ts route's path has folders after a [...rest] folder.",
    see: "/guides/server/#api-routes",
  },
  "route-clash": {
    when: "Two +server.ts files under src/api match the same URLs.",
    see: "/guides/server/#api-routes",
  },
  "route-file-misnamed": {
    when: "vite dev or vite build finds a file under src/api that looks like a route but is not named +server.ts or +server.js.",
    see: "/guides/server/#api-routes",
  },
  "thread-not-worker": {
    when: "The framework's worker-thread side starts outside a worker thread: a bug in the build's prerender or the conformance kit.",
  },
  "thread-method-unknown": {
    when: "The build process asks the prerender or conformance worker thread for a method it does not answer: a bug in the framework.",
  },
};
