/**
 * The Vite plugin of the Preact renderer: compiles the renderer's `.tsx` /
 * `.jsx` modules with Preact's automatic JSX runtime (`preact/jsx-runtime`),
 * in every environment, before Vite's own transform would apply its default
 * (React's). The same output serves the server and the browser, but for
 * Prefresh under `vite dev`.
 *
 * Next to React, Solid or Hono JSX, core passes `include`: only the modules
 * a Preact droplet reaches (marked `?droplets-renderer=preact`) are compiled
 * here, and every other `.tsx` stays with its own renderer. That is what
 * keeps Preact's JSX out of a React droplet in a mixed project, and React's
 * out of a Preact one.
 *
 * Prefresh, Preact's hot updates that keep hook state: in the browser under
 * `vite dev` the same modules compile with oxc's refresh transform on (the
 * `$RefreshReg$` and `$RefreshSig$` calls), in this transform alone, and get
 * `@prefresh/core`'s registration around them, with each module accepting
 * its own update. `@prefresh/vite` would switch refresh on in Vite's shared
 * `oxc` options instead, where every other compiler reads it; nothing of it
 * leaves these modules here.
 */
import { fileURLToPath } from "node:url";
import { transformWithOxc, type Plugin } from "vite";

const JSX_FILE = /\.[jt]sx$/;
const PACKAGE = "@dropletsjs/renderer-preact";
/** Where `@prefresh/core` and `@prefresh/utils` resolve from: this package. */
const here = fileURLToPath(import.meta.url);

/** Registers the module's components with Prefresh while it runs; one line, so the source map stays in step. */
const prelude = (core: string, utils: string, file: string) =>
  `import ${JSON.stringify(core)};import { flush as __prefresh_flush__ } from ${JSON.stringify(utils)};` +
  "let __prefresh_reg__, __prefresh_sig__;" +
  "if (import.meta.hot) {" +
  "__prefresh_reg__ = self.$RefreshReg$ || (() => {}); __prefresh_sig__ = self.$RefreshSig$ || (() => (type) => type);" +
  `self.$RefreshReg$ = (type, id) => { self.__PREFRESH__.register(type, ${JSON.stringify(file)} + " " + id); };` +
  "self.$RefreshSig$ = () => { let saved; let custom = false; let collected = false;" +
  " return (type, key, forceReset, getCustomHooks) => {" +
  "  if (typeof key === 'string') { if (!saved) { saved = type; custom = typeof getCustomHooks === 'function'; }" +
  "   if (type != null) self.__PREFRESH__.sign(type, key, forceReset, getCustomHooks, 'begin'); }" +
  "  else if (!collected && custom) { collected = true; self.__PREFRESH__.sign(saved, undefined, undefined, undefined, 'needsHooks'); }" +
  "  return type; }; };" +
  "}";

/** Puts the globals back and accepts the module's own update: Prefresh re-renders what changed. */
const footer = `
if (import.meta.hot) {
  self.$RefreshReg$ = __prefresh_reg__;
  self.$RefreshSig$ = __prefresh_sig__;
  import.meta.hot.accept(() => {
    try {
      __prefresh_flush__();
    } catch (error) {
      console.error("[droplets] Prefresh could not apply the update", error);
    }
  });
}
`;

/**
 * `include`, when set, matches the modules this renderer compiles (another
 * renderer claims `.tsx` too); unset, it compiles every `.tsx` / `.jsx`
 * outside `node_modules`.
 */
export function preactPlugin(include?: RegExp): Plugin {
  /** Under `vite dev`, with HMR on: Prefresh in the browser. */
  let refresh = false;

  return {
    name: "droplets:preact",
    enforce: "pre",

    // Prefresh's runtime is pre-bundled with Preact, so it patches the
    // page's one copy of it.
    config: (_config, env) =>
      env.command === "serve"
        ? { optimizeDeps: { include: [`${PACKAGE} > @prefresh/core`, `${PACKAGE} > @prefresh/utils`] } }
        : undefined,

    configResolved(config) {
      refresh = config.command === "serve" && !config.isProduction && config.server.hmr !== false;
    },

    async transform(code, id) {
      const file = id.replace(/[?#].*$/, "");
      if (!JSX_FILE.test(file) || file.includes("/node_modules/")) return null;
      if (include && !include.test(id)) return null;
      const hot = refresh && this.environment.config.consumer === "client";
      const result = await transformWithOxc(code, file, {
        lang: file.endsWith(".tsx") ? "tsx" : "jsx",
        jsx: { runtime: "automatic", importSource: "preact", ...(hot ? { refresh: true } : {}) },
        sourcemap: true,
      });
      const map = result.map ?? null;
      if (!hot || !/\$Refresh(?:Reg|Sig)\$\(/.test(result.code)) return { code: result.code, map };
      // Resolved for each module, not once: the pre-bundled copy's URL
      // carries Vite's hash of the optimized dependencies, which changes
      // when Vite optimizes them again.
      const [core, utils] = await Promise.all([this.resolve("@prefresh/core", here), this.resolve("@prefresh/utils", here)]);
      const found = core && utils ? { core: core.id, utils: utils.id } : null;
      if (!found) {
        this.warn("Prefresh's runtime (@prefresh/core, @prefresh/utils) did not resolve: Preact droplets remount on an edit");
        refresh = false;
        const plain = await transformWithOxc(code, file, {
          lang: file.endsWith(".tsx") ? "tsx" : "jsx",
          jsx: { runtime: "automatic", importSource: "preact" },
          sourcemap: true,
        });
        return { code: plain.code, map: plain.map ?? null };
      }
      // A module with hooks only (`$RefreshSig$`) is no boundary of its own:
      // its update reaches the component that uses it.
      const registers = /\$RefreshReg\$\(/.test(result.code);
      return { code: `${prelude(found.core, found.utils, file)}${result.code}${registers ? footer : ""}`, map };
    },
  };
}
