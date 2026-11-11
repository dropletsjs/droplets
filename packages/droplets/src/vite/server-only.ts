import { relative, resolve } from "node:path";
import type { Plugin } from "vite";
import { packageRoot } from "../core/paths.ts";
import type { PluginState } from "./state.ts";

/**
 * Server files never reach a browser bundle. A project file whose name has
 * `.server.` in it (`db.server.ts`, `+droplet.server.ts`, `hooks.server.ts`,
 * `query.server.js`), a `+server.*` route, or any file under a `server/`
 * folder (`src/lib/server/db.ts`) is server code: the client build fails when
 * its graph reaches one, through any chain, and the dev server refuses the
 * import, naming the chain. Dependencies and the framework's own files are
 * not checked.
 */

const SERVER_NAME = /(?:\.|^\+)server\.[^/]+$/;
const FRAMEWORK_DIRS = [resolve(packageRoot, "dist"), resolve(packageRoot, "src")];

const clean = (id: string) => id.replace(/[?#].*$/, "").replaceAll("\\", "/");

/**
 * Whether a path names a server file: `.server.` in its name before the
 * extension (`db.server.tsx`, `a.server.mjs`), a `+server.*` route, or a
 * folder on the way named exactly `server`. `observer.ts`,
 * `webserver.js` and `server-utils/x.ts` are not.
 */
export function isServerPath(path: string): boolean {
  const parts = clean(path).split("/");
  return SERVER_NAME.test(parts.at(-1) ?? "") || parts.slice(0, -1).includes("server");
}

/**
 * A module id as a path from the project root, for the server file checks;
 * `null` when it is not the project's to check: virtual modules,
 * dependencies, the framework's own files and files outside the project.
 */
export function projectPath(root: string, id: string): string | null {
  if (id.startsWith("\0") || id.startsWith("virtual:")) return null;
  const file = clean(id);
  const rel = relative(root, file).replaceAll("\\", "/");
  if (!rel || rel.startsWith("..") || rel.startsWith("/") || /^[a-z]:/i.test(rel)) return null;
  if (rel.split("/").includes("node_modules")) return null;
  if (FRAMEWORK_DIRS.some((dir) => !relative(dir, file).startsWith(".."))) return null;
  return rel;
}

/** Whether a module id is a project server file: by its name or a `server/` folder. */
export function isServerOnlyFile(root: string, id: string): boolean {
  const rel = projectPath(root, id);
  return rel !== null && isServerPath(rel);
}

function short(root: string, id: string): string {
  const file = clean(id);
  const prefix = `${root.replaceAll("\\", "/")}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

export function serverOnlyError(root: string, chain: string[]): Error {
  const file = chain.at(-1);
  if (file === undefined) throw new Error("droplets: an empty import chain");
  const path = chain.map((id) => short(root, id)).join(" -> ");
  return new Error(
    `droplets: ${short(root, file)} is server code and cannot reach the browser: ${path}. ` +
      `Files named *.server.* or under a server/ folder run on the server only: ` +
      `read them from +droplet.server.ts and pass what the browser needs as data.`,
  );
}

type GraphModule = { isEntry?: boolean; importedIds: readonly string[]; dynamicallyImportedIds: readonly string[] };

/** The chain from an entry to the first server file in a client build graph; `null` when there is none. */
export function findServerFile(root: string, moduleIds: Iterable<string>, getModule: (id: string) => GraphModule | null): string[] | null {
  const ids = [...moduleIds];
  const serverFile = ids.find((id) => isServerOnlyFile(root, id));
  if (serverFile === undefined) return null;
  const parent = new Map<string, string | null>();
  const queue: string[] = [];
  for (const id of ids) {
    if (getModule(id)?.isEntry) {
      parent.set(id, null);
      queue.push(id);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (isServerOnlyFile(root, current)) {
      const chain: string[] = [];
      for (let at: string | null = current; at; at = parent.get(at) ?? null) chain.unshift(at);
      return chain;
    }
    const info = getModule(current);
    if (!info) continue;
    for (const next of [...info.importedIds, ...info.dynamicallyImportedIds]) {
      if (parent.has(next)) continue;
      parent.set(next, current);
      queue.push(next);
    }
  }
  // Reached, but not from an entry we know: name it on its own.
  return [serverFile];
}

type DevModule = { id: string | null; importers: Set<DevModule> };

/** A chain of importers from a client module up to the module that has none. */
function importerChain(start: DevModule | undefined, importer: string): string[] {
  const chain = [importer];
  const seen = new Set<DevModule>();
  for (let module = start; module && !seen.has(module); ) {
    seen.add(module);
    const [next] = module.importers;
    if (!next?.id) break;
    chain.unshift(next.id);
    module = next;
  }
  return chain;
}

/** Refuses server files in the client environment, in dev and in the build. */
export function serverOnlyPlugin(state: PluginState): Plugin {
  let command: "serve" | "build" = "serve";
  return {
    name: "droplets:server-only",
    enforce: "pre",
    sharedDuringBuild: true,

    configResolved(config) {
      command = config.command;
    },

    resolveId: {
      order: "pre",
      async handler(source, importer, options) {
        if (command !== "serve" || !importer || this.environment.config.consumer !== "client") return null;
        if (source.startsWith("\0") || importer.startsWith("\0")) return null;
        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
        // Only refuses: resolving stays with the other plugins (renderer marks).
        if (!resolved || resolved.external || !isServerOnlyFile(state.root, resolved.id)) return null;
        const environment = this.environment;
        const graph = "moduleGraph" in environment ? environment.moduleGraph : undefined;
        const module = graph?.getModuleById(importer) as DevModule | undefined;
        this.error(serverOnlyError(state.root, [...importerChain(module, importer), resolved.id]).message);
      },
    },

    buildEnd(error) {
      if (error || command !== "build" || this.environment.config.consumer !== "client") return;
      const chain = findServerFile(state.root, this.getModuleIds(), (id) => this.getModuleInfo(id));
      if (chain) this.error(serverOnlyError(state.root, chain).message);
    },
  };
}
