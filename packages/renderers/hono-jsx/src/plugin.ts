/**
 * The Vite plugin of the Hono JSX renderer. Two jobs, per environment:
 *
 * - Compiles the renderer's `.tsx` / `.jsx` modules with the automatic JSX
 *   runtime of `hono/jsx` on the server and of `hono/jsx/dom` in the
 *   browser, before Vite's own transform would apply its default (React's).
 * - In the browser, resolves `hono/jsx` and its runtimes to their DOM
 *   builds, so a component imports hooks, `Suspense` or `ErrorBoundary`
 *   from `hono/jsx` on both sides, and a `@jsxImportSource hono/jsx`
 *   comment works in the browser too.
 */
import { transformWithOxc, type Plugin } from "vite";

const JSX_FILE = /\.[jt]sx$/;

/** `hono/jsx` and its runtimes, to what the browser uses instead. */
const DOM_BUILDS: Record<string, string> = {
  "hono/jsx": "hono/jsx/dom",
  "hono/jsx/jsx-runtime": "hono/jsx/dom/jsx-runtime",
  "hono/jsx/jsx-dev-runtime": "hono/jsx/dom/jsx-dev-runtime",
};

/**
 * `include`, when set, matches the modules this renderer compiles (another
 * renderer claims `.tsx` too); unset, it compiles every `.tsx` / `.jsx`
 * outside `node_modules`.
 */
export function honoJsxPlugin(include?: RegExp): Plugin {
  return {
    name: "droplets:hono-jsx",
    enforce: "pre",

    resolveId: {
      order: "pre",
      async handler(source, importer, options) {
        const dom = DOM_BUILDS[source];
        if (!dom || this.environment.config.consumer !== "client") return null;
        return this.resolve(dom, importer, { ...options, skipSelf: true });
      },
    },

    async transform(code, id) {
      const file = id.replace(/[?#].*$/, "");
      if (!JSX_FILE.test(file) || file.includes("/node_modules/")) return null;
      if (include && !include.test(id)) return null;
      const browser = this.environment.config.consumer === "client";
      const result = await transformWithOxc(code, file, {
        lang: file.endsWith(".tsx") ? "tsx" : "jsx",
        jsx: { runtime: "automatic", importSource: browser ? "hono/jsx/dom" : "hono/jsx" },
        sourcemap: true,
      });
      return { code: result.code, map: result.map ?? null };
    },
  };
}
