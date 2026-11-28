/**
 * The messages of `vite build` and `vite dev`: the bundles' graphs, CSS,
 * prerendering, the dev server, the generated modules and the renderer
 * conformance kit.
 *
 * @module
 */
import type { AnyMessage, ErrorPages } from "./format.ts";

export const SERVER_CODE_IN_CLIENT = {
  code: "server-code-in-client",
  level: "error",
  what: ({ file, path }: { file: string; path: string }) => `${file} is server code and cannot reach the browser: ${path}`,
  fix: "files named *.server.* or under a server/ folder run on the server only: read them from +droplet.server.ts and pass what the browser needs as data",
} satisfies AnyMessage;

export const SERVER_MODULE_IMPORT = {
  code: "server-module-import",
  level: "error",
  what: ({ id }: { id: string }) =>
    `${id} can only be imported by server files: names with .server. in them (+droplet.server.ts, hooks.server.ts, *.server.*), +server.* routes or files under a server/ folder`,
  fix: "import it from a server file and pass what the browser needs as data",
} satisfies AnyMessage;

export const IMPORT_CHAIN_EMPTY = {
  code: "import-chain-empty",
  level: "error",
  what: "the server-code check was handed an empty import chain",
  fix: "report it at https://github.com/dropletsjs/droplets/issues with the build's output",
} satisfies AnyMessage;

export const DROPLET_IMPORTS_OTHER_FRAMEWORK = {
  code: "droplet-imports-other-framework",
  level: "error",
  what: ({ renderer, owners, path }: { renderer: string; owners: string; path: string }) =>
    `a ${renderer} droplet imports ${owners} code: ${path}`,
  fix: "a droplet uses its own framework's modules and neutral code only: move the shared part into plain TypeScript, or render it from a droplet of that framework",
} satisfies AnyMessage;

export const HOOKS_IMPORTS_FRAMEWORK = {
  code: "hooks-imports-framework",
  level: "error",
  what: ({ file, owners, path }: { file: string; owners: string; path: string }) => `${file} imports ${owners} code: ${path}`,
  fix: "src/hooks.ts serves every droplet, whatever its framework: keep it, and what it imports, plain TypeScript",
} satisfies AnyMessage;

export const HOOKS_IMPORTS_NODE_BUILTIN = {
  code: "hooks-imports-node-builtin",
  level: "error",
  what: ({ file, id, path }: { file: string; id: string; path: string }) =>
    `${file} runs in the browser too and cannot reach the Node built-in ${id}: ${path}`,
  fix: "keep src/hooks.ts and what it imports on web APIs: encode and decode are pure, and server work belongs in +droplet.server.ts",
} satisfies AnyMessage;

export const LOAD_FILE_IMPORTS_CSS = {
  code: "load-file-imports-css",
  level: "error",
  what: ({ file, path }: { file: string; path: string }) => `${file} imports CSS: ${path}`,
  fix: "styles belong to the component: import them from +droplet.<ext> or +error.<ext> (or a <style> block)",
} satisfies AnyMessage;

export const ACTION_URL_OUTSIDE_RENDER = {
  code: "action-url-outside-render",
  level: "error",
  what: "actionUrl() of $droplets/form knows the droplet only while one renders",
  fix: "call it as the component sets up (React, Preact and Hono JSX: useState(() => actionUrl(...))), or pass { droplet }",
} satisfies AnyMessage;

export const RENDERER_NOT_CONFIGURED = {
  code: "renderer-not-configured",
  level: "error",
  what: ({ name }: { name: string }) => `no renderer named "${name}" is configured`,
  fix: "add that renderer to renderers in droplets() of the Vite config, or restart vite after removing its droplets",
} satisfies AnyMessage;

export const POSTCSS_CONFIG_FAILED = {
  code: "postcss-config-failed",
  level: "error",
  what: ({ reason }: { reason: string }) => `the PostCSS config failed to load: ${reason}`,
  fix: "fix the error the file throws, or remove the file",
} satisfies AnyMessage;

export const TAILWIND_PREFLIGHT_LEFT = {
  code: "tailwind-preflight-left",
  level: "warning",
  what: "the stylesheet still has Tailwind's preflight with css.twPreflight off: it is imported where Vite does not see it",
  fix: 'import "tailwindcss/theme.css" and "tailwindcss/utilities.css" there instead',
} satisfies AnyMessage;

export const TAILWIND_NOT_INSTALLED = {
  code: "tailwind-not-installed",
  level: "error",
  what: "css.tailwind needs Tailwind installed",
  fix: "pnpm add -D tailwindcss @tailwindcss/vite (or npm install -D …), or set css.tailwind to false",
} satisfies AnyMessage;

export const DROPLET_SCAN_FAILED = {
  code: "droplet-scan-failed",
  level: "error",
  what: "the droplet folders could not be read again; vite dev keeps serving the droplets it found before; the reason follows",
  fix: "fix what the reason names in the droplets folder; the next change there scans again",
} satisfies AnyMessage;

export const CLIENT_ENVIRONMENT_MISSING = {
  code: "client-environment-missing",
  level: "error",
  what: "Vite has no client environment",
  fix: "keep Vite's client environment in the Vite config (environments.client)",
} satisfies AnyMessage;

export const IMPORT_MAP_EXTERNAL_UNMAPPED = {
  code: "import-map-external-unmapped",
  level: "warning",
  what: ({ name }: { name: string }) => `${name} is external but the import map does not map it; the browser cannot load it`,
  fix: "map it in importmap of src/importmap.server.ts, or bundle it (warnImportMap: false hides this)",
} satisfies AnyMessage;

export const IMPORT_MAP_ENTRY_UNUSED = {
  code: "import-map-entry-unused",
  level: "warning",
  what: ({ name }: { name: string }) => `the import map maps ${name}, which is not external; it is bundled and the entry is unused`,
  fix: "remove the entry, or make the package external in the Vite config (warnImportMap: false hides this)",
} satisfies AnyMessage;

export const IMPORT_MAP_VERSION_MISMATCH = {
  code: "import-map-version-mismatch",
  level: "warning",
  what: ({ name, wanted, installed }: { name: string; wanted: string; installed: string }) =>
    `${name}: the import map loads ${wanted} in the browser, the server renders with ${installed}; hydration may not match`,
  fix: "point the import map at the installed version, or install the one it loads (warnImportMap: false hides this)",
} satisfies AnyMessage;

export const PRERENDER_FILE_IN_DEV = {
  code: "prerender-file-in-dev",
  level: "warning",
  what: ({ path }: { path: string; id: string }) =>
    `${path}: prerender files are written by vite build only, with location and host set in droplets.config.ts; vite dev writes and serves none`,
  fix: ({ id }: { path: string; id: string }) =>
    `in dev, ask for the live fragment /droplets/${id}; to test the files, run vite build and vite preview (with location set, the URLs inside a file point at that location)`,
} satisfies AnyMessage;

export const OUT_DIR_OUTSIDE_PROJECT = {
  code: "out-dir-outside-project",
  level: "warning",
  what: ({ outDir }: { outDir: string }) => `${outDir} is outside the project and is not emptied`,
  fix: "set build.emptyOutDir to true to empty it",
} satisfies AnyMessage;

export const ADAPTER_MISSING = {
  code: "adapter-missing",
  level: "error",
  what: "`vite build` needs an adapter",
  fix: 'install one and pass it to the plugin, e.g.\n  import { node } from "@dropletsjs/adapter-node";\n  droplets({ adapter: node() })',
} satisfies AnyMessage;

export const ENTRY_STYLES_PLACEHOLDER_MISSING = {
  code: "entry-styles-placeholder-missing",
  level: "error",
  what: "the entry client has no room for the droplets' stylesheets: its placeholder string is gone",
  fix: "keep plugins of the client build from rewriting string literals in the entry client; report it if none does",
} satisfies AnyMessage;

export const VITE_MANIFEST_MISSING = {
  code: "vite-manifest-missing",
  level: "warning",
  what: "vite manifest missing; CSS paths will fall back and /index.js has no entry",
  fix: "leave build.manifest of the client environment as the plugin sets it (true)",
} satisfies AnyMessage;

export const PRERENDER_HOST_OUTSIDE_HOST = {
  code: "prerender-host-outside-host",
  level: "error",
  what: ({ entry, host, fixed }: { entry: string; host: string; fixed: string }) =>
    `the entry ${entry} names host ${host}, outside host in droplets.config.ts (${fixed})`,
  fix: "drop the entry's host or change it to that origin",
} satisfies AnyMessage;

export const PRERENDER_HOST_UNTRUSTED = {
  code: "prerender-host-untrusted",
  level: "error",
  what: ({ entry, host, sources, origins }: { entry: string; host: string; sources: string; origins: string }) =>
    `the entry ${entry} names host ${host}, outside ${sources} (${origins})`,
  fix: "add the origin there or drop the entry's host",
} satisfies AnyMessage;

export const PRERENDER_MANIFEST_MISSING = {
  code: "prerender-manifest-missing",
  level: "error",
  what: "cannot prerender before droplets.json is written",
  fix: "run vite build, which builds the client and writes droplets.json before it prerenders",
} satisfies AnyMessage;

export const PRERENDER_RENDER_NOT_STORED = {
  code: "prerender-render-not-stored",
  level: "warning",
  what: ({ props, status, path }: { props: string; status: number; path: string }) =>
    `prerendering with ${props} answered ${status}; not stored, it renders live${path ? `, and ${path} is not written` : ""}`,
  fix: "make the loads answer for these props (error() and redirect() are never stored), or drop the entry",
} satisfies AnyMessage;

export const PRERENDER_FILE_ERROR_PAGE = {
  code: "prerender-file-error-page",
  level: "warning",
  what: ({ props, path }: { props: string; path: string }) =>
    `prerendering with ${props} failed and stored its +error page; ${path} is not written`,
  fix: "fix the load for these props: the file is written once its render succeeds",
} satisfies AnyMessage;

export const PRERENDER_FILE_NOT_WRITTEN = {
  code: "prerender-file-not-written",
  level: "warning",
  what: ({ props, status, path }: { props: string; status: number; path: string }) =>
    `prerendering with ${props}: the fragment answered ${status}; ${path} is not written`,
  fix: "make the fragment answer 200 for these props, or drop the entry's file",
} satisfies AnyMessage;

export const PRERENDER_FILE_HEADERS_DROPPED = {
  code: "prerender-file-headers-dropped",
  level: "warning",
  what: ({ headers, path }: { headers: string; path: string }) =>
    `the load set ${headers} with setHeaders; ${path} is served with fragmentCacheControl and _headers only, without them`,
  fix: "set those headers in _headers (Cloudflare) or in the server in front, or drop the entry's file",
} satisfies AnyMessage;

export const PRERENDER_FILES_NEED_LOCATION_AND_HOST = {
  code: "prerender-files-need-location-and-host",
  level: "warning",
  what: ({ listed, missing }: { listed: string; missing: string }) =>
    `prerender entries name files (${listed}), but files are written only with both location and host set in droplets.config.ts (${missing} not set); no file is written, and these renders are served by the server as before`,
  fix: "set location and host in droplets.config.ts to write the files, or drop file from the entries",
} satisfies AnyMessage;

export const SSR_BUNDLE_CANNOT_PRERENDER = {
  code: "ssr-bundle-cannot-prerender",
  level: "error",
  what: "the SSR bundle cannot prerender (no renderDroplet or getEntries)",
  fix: "build it with vite build and the droplets plugin; report it if it persists",
} satisfies AnyMessage;

export const PRERENDER_FILE_RENDER_MISSING = {
  code: "prerender-file-render-missing",
  level: "error",
  what: "no render is stored to write as a file",
  fix: "report it at https://github.com/dropletsjs/droplets/issues: a file is written only for a render the build stored",
} satisfies AnyMessage;

export const MODULE_FILE_MISNAMED = {
  code: "module-file-misnamed",
  level: "warning",
  what: "the file is not loaded: its extension is not one the framework looks up",
  fix: ({ names }: { names: string }) => `name it ${names}`,
} satisfies AnyMessage;

export const INDEX_FILE_MISSING = {
  code: "index-file-missing",
  level: "error",
  what: ({ index }: { index: string }) => `index points at ${index}, which does not exist`,
  fix: "create the file, fix the path in droplets.config.ts (relative to the project root), or remove index",
} satisfies AnyMessage;

export const TYPES_NOT_WRITTEN = {
  code: "types-not-written",
  level: "warning",
  what: ({ dir, reason }: { dir: string; reason: string }) => `could not write ${dir}/: ${reason}`,
  fix: "make the project folder writable, then run djs sync",
} satisfies AnyMessage;

export const PLUGIN_FETCH_OUTSIDE_DEV = {
  code: "plugin-fetch-outside-dev",
  level: "error",
  what: "fetch of the droplets plugin's api is only available under vite dev",
  fix: "call api.fetch from a Vite dev server hook (configureServer) only",
} satisfies AnyMessage;

export const STATIC_ENV_MISSING = {
  code: "static-env-missing",
  level: "error",
  what: ({ names }: { names: string }) => `static environment variables without a value: ${names}`,
  fix: "set them in .env or the environment (vite build stops, vite dev keeps running so you can fix it live)",
} satisfies AnyMessage;

export const NO_DROPLETS_FOUND = {
  code: "no-droplets-found",
  level: "warning",
  what: ({ folder }: { folder: string }) => `no droplets found in ${folder}`,
  fix: "add a folder <id>/ with a +droplet.<ext> component there, or point dropletsFolder in droplets.config.ts at the right folder",
} satisfies AnyMessage;

export const BUILDER_REQUIRED = {
  code: "builder-required",
  level: "error",
  what: "vite build (the builder) is required; build() alone builds one environment",
  fix: "use createBuilder() or the vite build command",
} satisfies AnyMessage;

export const BUILD_ENVIRONMENT_MISSING = {
  code: "build-environment-missing",
  level: "error",
  what: ({ name }: { name: string }) => `missing build environment "${name}"`,
  fix: "keep the environments the plugin adds (client, ssr, server) in the Vite config",
} satisfies AnyMessage;

export const CLIENT_BUILD_MISSING = {
  code: "client-build-missing",
  level: "error",
  what: "the client environment did not build",
  fix: "read the client build's errors above and fix them",
} satisfies AnyMessage;

export const ADAPTER_PREVIEW_MISSING = {
  code: "adapter-preview-missing",
  level: "warning",
  what: ({ adapter }: { adapter: string }) => `the ${adapter} adapter has no preview`,
  fix: "use its own tooling to run the build (wrangler dev for Cloudflare)",
} satisfies AnyMessage;

export const PREVIEW_ADAPTER_MISSING = {
  code: "preview-adapter-missing",
  level: "warning",
  what: "vite preview needs an adapter with preview support",
  fix: "pass one to the plugin, e.g. node() from @dropletsjs/adapter-node",
} satisfies AnyMessage;

export const CONFORMANCE_MANIFEST_MISSING = {
  code: "conformance-manifest-missing",
  level: "error",
  what: "dist/client/droplets.json: the build wrote no manifest",
  fix: "read the fixture build's errors above and fix them",
} satisfies AnyMessage;

export const CONFORMANCE_CLIENT_BUNDLE_MISSING = {
  code: "conformance-client-bundle-missing",
  level: "error",
  what: ({ url }: { url: string }) => `no client bundle for ${url}`,
  fix: "check that the fixture's droplet built for the browser: droplets.json lists a client for it",
} satisfies AnyMessage;

export const BUILD_PAGES: ErrorPages = {
  "server-code-in-client": {
    when: "vite build or vite dev, when a browser bundle reaches a *.server.* file, a +server.* route or a file under a server/ folder, through any import chain or as a file URL. The message names the chain.",
    see: "/guides/writing-droplets/#where-code-runs",
  },
  "server-module-import": {
    when: "vite build or vite dev, when a browser module, or a file that is not server code, imports a server-only module such as $droplets/server or $droplets/env/private.",
    see: "/guides/writing-droplets/#where-code-runs",
  },
  "import-chain-empty": {
    when: "vite build, if the server-code check is asked to name an empty chain; a bug in Droplets, never in a project.",
  },
  "droplet-imports-other-framework": {
    when: "vite build or vite dev, when a droplet's graph reaches another configured renderer's files or packages. The message names the chain.",
    see: "/renderers/",
  },
  "hooks-imports-framework": {
    when: "vite build or vite dev, when src/hooks.ts reaches a configured renderer's files or packages. The message names the chain.",
    see: "/guides/writing-droplets/#your-own-types",
  },
  "hooks-imports-node-builtin": {
    when: "vite build or vite dev, when src/hooks.ts, or a project file it imports, imports a Node built-in (node:fs, path, …). The message names the chain.",
    see: "/guides/writing-droplets/#your-own-types",
  },
  "load-file-imports-css": {
    when: "vite build or vite dev, when +droplet.ts or +droplet.server.ts imports a stylesheet, directly or through other modules.",
    see: "/guides/styling/#how-styles-reach-the-page",
  },
  "action-url-outside-render": {
    when: "On the server or in the browser, when actionUrl() of $droplets/form is called without { droplet } while no droplet renders, for example in an event handler.",
    see: "/guides/actions/#where-a-form-posts",
  },
  "renderer-not-configured": {
    when: "vite build or vite dev, when a droplet is registered for a renderer the plugin no longer has, usually after a renderer was removed from the Vite config.",
    see: "/guides/configuration/#plugin-options",
  },
  "postcss-config-failed": {
    when: "vite build or vite dev, when the project's PostCSS config file throws as it loads.",
    see: "/guides/styling/",
  },
  "tailwind-preflight-left": {
    when: "vite build or vite dev, with css.twPreflight false, when a stylesheet still holds Tailwind's preflight because it imports tailwindcss somewhere Vite does not see.",
    see: "/guides/configuration/#preflight-in-dev-only",
  },
  "tailwind-not-installed": {
    when: "vite build or vite dev, when css.tailwind is on and neither tailwindcss nor @tailwindcss/vite can be loaded.",
    see: "/guides/styling/#tailwind",
  },
  "droplet-scan-failed": {
    when: "vite dev, when a change in the droplets folder leaves it in a state the scan refuses, such as two components in one folder.",
    see: "/guides/development/#the-dev-server",
  },
  "client-environment-missing": {
    when: "vite dev, when the Vite config removed the client environment the plugin serves the browser from.",
  },
  "import-map-external-unmapped": {
    when: "vite dev, with warnImportMap on, when the client build has an external that src/importmap.server.ts does not map.",
    see: "/guides/import-maps/#under-vite-dev",
  },
  "import-map-entry-unused": {
    when: "vite dev, with warnImportMap on, when the import map names a package the client build bundles.",
    see: "/guides/import-maps/#under-vite-dev",
  },
  "import-map-version-mismatch": {
    when: "vite dev, with warnImportMap on, when the version in an import map URL differs from the installed package the server renders with.",
    see: "/guides/import-maps/#version-drift",
  },
  "prerender-file-in-dev": {
    when: "vite dev, the first time a path under /assets/prerendered/ is asked for; it answers 404.",
    see: "/guides/prerendering/#in-vite-dev",
  },
  "out-dir-outside-project": {
    when: "vite build, when the output folder is outside the project and build.emptyOutDir is not set.",
  },
  "adapter-missing": {
    when: "vite build, when droplets() has no adapter.",
    see: "/guides/deployment/#adapters",
  },
  "entry-styles-placeholder-missing": {
    when: "vite build, when the built entry client no longer holds the placeholder the build writes the droplets' stylesheets into.",
  },
  "vite-manifest-missing": {
    when: "vite build, when the client build wrote no .vite/manifest.json.",
  },
  "prerender-host-outside-host": {
    when: "vite build, when an entry of entries() names a host on another origin than host in droplets.config.ts.",
    see: "/guides/prerendering/#host-at-build",
  },
  "prerender-host-untrusted": {
    when: "vite build, without host in droplets.config.ts, when an entry of entries() names a host outside trustedOrigins or DROPLETS_TRUSTED_ORIGINS.",
    see: "/guides/prerendering/#host-at-build",
  },
  "prerender-manifest-missing": {
    when: "vite build, if the prerender pass starts before the client build wrote droplets.json.",
  },
  "prerender-render-not-stored": {
    when: "vite build, when a prerender entry's render answers anything but a render: error(), redirect() or a failure without an error page.",
    see: "/guides/prerendering/",
  },
  "prerender-file-error-page": {
    when: "vite build, when the render of an entry that names a file failed and stored the +error page.",
    see: "/guides/prerendering/#static-files",
  },
  "prerender-file-not-written": {
    when: "vite build, when the fragment for an entry that names a file answers another status than 200.",
    see: "/guides/prerendering/#static-files",
  },
  "prerender-file-headers-dropped": {
    when: "vite build, when the load of an entry that names a file sets headers with setHeaders, which a static file does not carry.",
    see: "/guides/prerendering/#headers",
  },
  "prerender-files-need-location-and-host": {
    when: "vite build, when entries name files but droplets.config.ts lacks location, host or both.",
    see: "/guides/prerendering/#static-files",
  },
  "ssr-bundle-cannot-prerender": {
    when: "vite build, when the SSR bundle the prerender loads exports neither renderDroplet nor getEntries.",
  },
  "prerender-file-render-missing": {
    when: "vite build, if a file is asked for a render the build did not store; a bug in Droplets.",
  },
  "module-file-misnamed": {
    when: "vite build or vite dev, when src/hooks, src/hooks.server or src/importmap.server has an extension the framework does not look up (.mts, .mjs, .cts, .cjs).",
    see: "/guides/server/",
  },
  "index-file-missing": {
    when: "vite build, vite dev or vite preview, when index in droplets.config.ts names a file that does not exist.",
    see: "/guides/configuration/#options",
  },
  "types-not-written": {
    when: "vite dev, vite build or djs sync, when the .droplets/ folder of ./$types cannot be written.",
    see: "/guides/writing-droplets/#types-types",
  },
  "plugin-fetch-outside-dev": {
    when: "When a Vite plugin calls the droplets plugin's api.fetch outside vite dev.",
  },
  "static-env-missing": {
    when: "vite build (an error) or vite dev (logged, the server keeps running), when a variable declared static in src/env.ts has no value.",
    see: "/guides/server/#environment-variables",
  },
  "no-droplets-found": {
    when: "vite build, when the droplets folder holds no droplet.",
    see: "/guides/writing-droplets/#structure",
  },
  "builder-required": {
    when: "When Vite's build() runs one environment alone instead of the builder (createBuilder() or the vite build command).",
  },
  "build-environment-missing": {
    when: "vite build, when one of the plugin's environments (client, ssr, server) is missing from the builder.",
  },
  "client-build-missing": {
    when: "vite build, when the client environment produced nothing.",
  },
  "adapter-preview-missing": {
    when: "vite preview, when the adapter has no preview of its own.",
    see: "/guides/deployment/#adapters",
  },
  "preview-adapter-missing": {
    when: "vite preview, when droplets() has no adapter.",
    see: "/guides/deployment/#adapters",
  },
  "conformance-manifest-missing": {
    when: "rendererConformance() of @dropletsjs/droplets/testing, when the fixture's build wrote no droplets.json.",
  },
  "conformance-client-bundle-missing": {
    when: "rendererConformance() of @dropletsjs/droplets/testing, when the element asks for a droplet the fixture build has no browser bundle for.",
  },
};
