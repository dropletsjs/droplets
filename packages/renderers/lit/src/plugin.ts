/**
 * The Vite plugin of the Lit renderer. Components are plain TypeScript, so
 * there is nothing to compile; three jobs instead:
 *
 * - `virtual:droplets-renderer-lit`, the tag prefix, for the renderer's
 *   server and client modules: `lit({ prefix })`, else the droplets
 *   server's element name, read from the core plugin once the config is
 *   resolved.
 * - Server builds bundle Lit and its SSR packages (`resolve.noExternal`):
 *   one copy of `lit-html` for the components and for `@lit-labs/ssr`, whose
 *   own dependencies a project never lists.
 * - Server builds use Lit's server build (`lit-html/node/…`,
 *   `@lit/reactive-element/node/…`), which runs on `@lit-labs/ssr-dom-shim`.
 *   Vite picks it through the `node` export condition; an adapter that
 *   resolves without it (Cloudflare Workers: `workerd`, `worker`) would get
 *   the browser build, which touches `document` and `HTMLElement` as it is
 *   evaluated and fails at startup. There the plugin swaps each such file
 *   for its `node/` twin: those import no Node module.
 */
import { existsSync } from "node:fs";
import type { Plugin } from "vite";

export const PREFIX_MODULE = "virtual:droplets-renderer-lit";
const RESOLVED_PREFIX_MODULE = `\0${PREFIX_MODULE}`;

/** What server builds bundle rather than import at runtime. */
export const SERVER_BUNDLED = [
  "lit",
  "lit-html",
  "lit-element",
  "@lit/reactive-element",
  "@lit-labs/ssr",
  "@lit-labs/ssr-client",
  "@lit-labs/ssr-dom-shim",
];

/** The packages that ship a server build next to the browser one. */
const WITH_SERVER_BUILD = /^(lit-html|@lit\/reactive-element)(?:\/|$)/;
const BROWSER_FILE = /^(.*\/node_modules\/(?:lit-html|@lit\/reactive-element))\/(?!node\/)(.+\.js)$/;

type ServerBuildOfInput = { file: string; exists?: (path: string) => boolean };

/**
 * The server build of a resolved browser-build file of `lit-html` or
 * `@lit/reactive-element`: `…/lit-html/directive.js` →
 * `…/lit-html/node/directive.js` (`development/` keeps its place under
 * `node/`). `null` when it is no such file or has no twin on disk.
 */
export function serverBuildOf({ file, exists = existsSync }: ServerBuildOfInput): string | null {
  const match = BROWSER_FILE.exec(file.replaceAll("\\", "/"));
  if (!match) return null;
  const twin = `${match[1]}/node/${match[2]}`;
  return exists(twin) ? twin : null;
}

type CorePlugin = { name?: string; api?: { element?: () => string } };

export type LitPluginOptions = { prefix?: string };

export function litPlugin(options: LitPluginOptions = {}): Plugin {
  let prefix = options.prefix;
  return {
    name: "droplets:lit",
    enforce: "pre",

    configResolved(config) {
      if (options.prefix) return;
      const core = (config.plugins as readonly CorePlugin[]).find((plugin) => plugin.name === "droplets");
      prefix = core?.api?.element?.() ?? "lit";
    },

    configEnvironment(name, config) {
      const consumer = config.consumer ?? (name === "client" ? "client" : "server");
      if (consumer === "client") return;
      return { resolve: { noExternal: SERVER_BUNDLED } };
    },

    resolveId: {
      order: "pre",
      async handler(source, importer, resolveOptions) {
        if (source === PREFIX_MODULE) return RESOLVED_PREFIX_MODULE;
        if (!WITH_SERVER_BUILD.test(source)) return null;
        const environment = this.environment.config;
        if (environment.consumer === "client" || environment.resolve.conditions.includes("node")) return null;
        const resolved = await this.resolve(source, importer, { ...resolveOptions, skipSelf: true });
        if (!resolved || resolved.external) return resolved;
        const twin = serverBuildOf({ file: resolved.id.replace(/[?#].*$/, "") });
        return twin ? { ...resolved, id: twin } : resolved;
      },
    },

    load(id) {
      if (id !== RESOLVED_PREFIX_MODULE) return null;
      return `export const prefix = ${JSON.stringify(prefix ?? "lit")};\n`;
    },
  };
}
