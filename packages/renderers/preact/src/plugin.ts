/**
 * The Vite plugin of the Preact renderer: compiles the renderer's `.tsx` /
 * `.jsx` modules with Preact's automatic JSX runtime (`preact/jsx-runtime`),
 * in every environment, before Vite's own transform would apply its default
 * (React's). The same output serves the server and the browser.
 *
 * Next to React, Solid or Hono JSX, core passes `include`: only the modules
 * a Preact droplet reaches (marked `?droplets-renderer=preact`) are compiled
 * here, and every other `.tsx` stays with its own renderer. That is what
 * keeps Preact's JSX out of a React droplet in a mixed project, and React's
 * out of a Preact one.
 */
import { transformWithOxc, type Plugin } from "vite";

const JSX_FILE = /\.[jt]sx$/;

/**
 * `include`, when set, matches the modules this renderer compiles (another
 * renderer claims `.tsx` too); unset, it compiles every `.tsx` / `.jsx`
 * outside `node_modules`.
 */
export function preactPlugin(include?: RegExp): Plugin {
  return {
    name: "droplets:preact",
    enforce: "pre",

    async transform(code, id) {
      const file = id.replace(/[?#].*$/, "");
      if (!JSX_FILE.test(file) || file.includes("/node_modules/")) return null;
      if (include && !include.test(id)) return null;
      const result = await transformWithOxc(code, file, {
        lang: file.endsWith(".tsx") ? "tsx" : "jsx",
        jsx: { runtime: "automatic", importSource: "preact" },
        sourcemap: true,
      });
      return { code: result.code, map: result.map ?? null };
    },
  };
}
