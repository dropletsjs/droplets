/**
 * React Fast Refresh, for React's own modules only.
 *
 * `@vitejs/plugin-react` turns refresh on in Vite's shared `oxc` options
 * (`oxc.jsx.refresh`) and leaves it to Vite's transform to narrow it per
 * module. Other renderers' compilers read those shared options too:
 * `@vitejs/plugin-vue` hands them to the TypeScript of every
 * `<script lang="ts">`, so a Vue composable's `useForm()` call is signed as
 * a React hook, with a `$RefreshSig$` that the server, and a page without
 * React, does not have.
 *
 * This plugin turns refresh off in the shared options and compiles the
 * modules React owns with it on, in the browser under `vite dev`: core's
 * `include` when another renderer shares `.tsx`, plugin-react's otherwise.
 * Vite's own transform then sees plain JavaScript, and plugin-react's
 * refresh wrapper makes each such module its own HMR boundary, as before.
 */
import { createFilter, transformWithOxc, type Plugin, type ResolvedConfig, type UserConfig } from "vite";
import type { Options } from "@vitejs/plugin-react";

type OxcOptions = Exclude<NonNullable<UserConfig["oxc"]>, false>;
type JsxOptions = Extract<NonNullable<OxcOptions["jsx"]>, object>;

/** plugin-react's defaults, for the modules it compiles. */
const DEFAULT_INCLUDE = /\.[tj]sx?$/;
const DEFAULT_EXCLUDE = /\/node_modules\//;

const clean = (id: string) => id.replace(/[?#].*$/, "");

/** The `lang` of a module for oxc, by its extension; JavaScript (JSX allowed) otherwise. */
function langOf(file: string): "ts" | "tsx" | "js" | "jsx" {
  if (/\.[mc]?ts$/.test(file)) return "ts";
  if (file.endsWith(".tsx")) return "tsx";
  if (file.endsWith(".jsx")) return "jsx";
  return "js";
}

/**
 * `include`, when set, matches the modules core assigns to React (another
 * renderer claims `.tsx` too); it takes the place of plugin-react's own, as
 * it does for plugin-react.
 */
export function reactRefreshPlugin(options: Options = {}, include?: RegExp): Plugin {
  const filter = createFilter(
    options.refreshInclude ?? include ?? options.include ?? DEFAULT_INCLUDE,
    options.refreshExclude ?? options.exclude ?? DEFAULT_EXCLUDE,
    { resolve: false },
  );
  const importSource = options.jsxImportSource ?? "react";
  const runtimes = [`${importSource}/jsx-runtime`, `${importSource}/jsx-dev-runtime`];
  /** plugin-react turned refresh on in the shared options; this plugin took it back. */
  let requested = false;
  /** The resolved config and its shared options (refresh off), once refresh applies. */
  let shared: { config: ResolvedConfig; oxc: OxcOptions; jsx: JsxOptions } | undefined;

  return {
    name: "droplets:react-refresh",
    enforce: "pre",
    apply: "serve",

    // After plugin-react's own `config` hooks: they decide whether refresh is on.
    config: {
      order: "post",
      handler(config) {
        const jsx = config.oxc ? config.oxc.jsx : undefined;
        if (typeof jsx !== "object" || !jsx.refresh) return;
        requested = true;
        return { oxc: { jsx: { refresh: false } } };
      },
    },

    configResolved(config) {
      const jsx = config.oxc ? config.oxc.jsx : undefined;
      if (!requested || !config.oxc || typeof jsx !== "object") return;
      if (config.isProduction || config.server.hmr === false) return;
      shared = { config, oxc: config.oxc, jsx };
    },

    async transform(code, id) {
      if (!shared || this.environment.config.consumer !== "client") return null;
      const file = clean(id);
      // Core's mark is a query; plugin-react's patterns match the file.
      if (!filter(include ? id : file)) return null;
      // Vite's own rule: refresh a module that has JSX or imports its runtime.
      if (!file.endsWith("x") && !runtimes.some((runtime) => code.includes(runtime))) return null;
      // The shared options, as Vite's transform would apply them, minus its
      // own filter keys; refresh on for this module alone.
      const { include: _i, exclude: _e, jsxInject: _j, jsxRefreshInclude: _ri, jsxRefreshExclude: _re, ...oxc } = shared.oxc;
      const result = await transformWithOxc(code, id, {
        ...oxc,
        lang: langOf(file),
        jsx: { ...shared.jsx, refresh: true },
        sourcemap: true,
      }, undefined, shared.config);
      return { code: result.code, map: result.map ?? null };
    },
  };
}
