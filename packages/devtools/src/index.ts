import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Connect, Plugin } from "vite";
import type { DropletsPluginApi } from "@dropletsjs/droplets/vite";
import { renderDevtoolsPage, withPageStyles, type ServerRender } from "./page.tsx";
import { fragmentRequest, readToolState } from "./shared.ts";

export { renderDevtoolsPage, type DevtoolsPageInput, type ServerRender } from "./page.tsx";

// `src/` and `dist/` both sit directly under the package root.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The compiled browser script; Vite serves and transforms it. */
const clientFile = resolve(packageRoot, "dist/client/devtools-page.js");
/** The floating dev tool, which `index.js` imports on any page that asks for it. */
const toolFile = resolve(packageRoot, "dist/tool/panel.js");
/** The droplets and their flags, for the dev tool on any page. */
const TOOL_INFO = "/__droplets/devtools.json";

/** An absolute path as a URL the Vite dev server transforms. */
function fsUrl(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return `/@fs${normalized.startsWith("/") ? "" : "/"}${normalized}`;
}

function originOf(req: Connect.IncomingMessage): string {
  return `http://${req.headers.host ?? "localhost"}`;
}

/** The import map block, as a host would include it; `""` without one. */
async function importMapBlock(api: DropletsPluginApi, origin: string): Promise<string> {
  const path = api.importMapPath();
  if (!path) return "";
  const response = await api.fetch(new Request(`${origin}${path}`));
  return response.ok ? response.text() : "";
}

/**
 * Server mode: fetch the fragment the way a host's server would, through the
 * droplets app and its hooks, then hand it to the page with its styles.
 */
async function renderOnServer(
  api: DropletsPluginApi,
  origin: string,
  search: string,
): Promise<ServerRender | undefined> {
  const state = readToolState(search, api.droplets());
  if (!state.droplet) return undefined;
  const { url, init } = fragmentRequest(state.droplet, state.method, state.props);
  const started = performance.now();
  const response = await api.fetch(new Request(`${origin}${url}`, init));
  const html = await response.text();
  const base = `/droplets/${encodeURIComponent(state.droplet)}`;
  return {
    droplet: state.droplet,
    method: state.method,
    props: state.props,
    status: response.status,
    ms: Math.round(performance.now() - started),
    bytes: new TextEncoder().encode(html).length,
    // Only HTML belongs in the page; an error without an error page is text.
    html: (response.headers.get("content-type") ?? "").includes("text/html") ? html : "",
    styles: ["/index.css", `${base}/style.css`],
  };
}

/**
 * The droplets development page, served at `/` by `vite dev` only. It never
 * runs in `vite build` or `vite preview`, so nothing of it reaches a build.
 *
 * `/` is client mode: the browser fetches the droplet and inserts it.
 * `/?droplet=<id>&props=<json>&method=GET|POST` is server mode: the page
 * arrives with the droplet already in it, as from a host that renders on the
 * server.
 *
 * ```ts
 * // vite.config.ts
 * import { droplets } from "@dropletsjs/droplets/vite";
 * import { dropletsDevtools } from "@dropletsjs/devtools";
 *
 * export default defineConfig({ plugins: [droplets({ adapter }), dropletsDevtools()] });
 * ```
 */
export function dropletsDevtools(): Plugin {
  let api: DropletsPluginApi | undefined;

  return {
    name: "droplets:devtools",
    apply: (_config, env) => env.command === "serve" && !env.isPreview,

    config: () => ({ server: { fs: { allow: [packageRoot] } } }),

    configResolved(config) {
      const core = config.plugins.find((plugin) => plugin.name === "droplets");
      api = core?.api as DropletsPluginApi | undefined;
      if (!api) {
        throw new Error(
          "@dropletsjs/devtools: add droplets() from @dropletsjs/droplets/vite to the plugins too",
        );
      }
      api.setDevTool(fsUrl(toolFile));
    },

    configureServer(server) {
      // Registered directly, so it answers `/` before the droplets app does.
      server.middlewares.use(async (req, res, next) => {
        const [pathname, query = ""] = (req.url ?? "/").split("?");
        if (req.method === "GET" && pathname === TOOL_INFO && api) {
          res.statusCode = 200;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.setHeader("cache-control", "no-store");
          // The tool runs on host pages of any origin.
          res.setHeader("access-control-allow-origin", "*");
          res.end(JSON.stringify({ element: api.element(), droplets: api.droplets() }));
          return;
        }
        if (req.method !== "GET" || pathname !== "/" || !api) {
          next();
          return;
        }
        try {
          const origin = originOf(req);
          const search = query ? `?${query}` : "";
          const serverMode = new URLSearchParams(search).has("droplet");
          // Added after Vite: it runs inline `<style>` through PostCSS, where
          // the droplets scoping would nest the page's CSS under the element.
          const transformed = await server.transformIndexHtml(
            req.url ?? "/",
            renderDevtoolsPage({
              element: api.element(),
              droplets: api.droplets(),
              importMap: await importMapBlock(api, origin),
              loaderUrl: api.loaderUrl,
              clientUrl: fsUrl(clientFile),
              server: serverMode ? await renderOnServer(api, origin, search) : undefined,
              strategy: api.strategy(),
              pageStyles: false,
            }),
            req.originalUrl,
          );
          const html = withPageStyles(transformed);
          res.statusCode = 200;
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.setHeader("cache-control", "no-store");
          res.end(html);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
