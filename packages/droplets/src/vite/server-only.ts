import { relative, resolve } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { packageRoot } from "../core/paths.ts";
import type { PluginState } from "./state.ts";

/**
 * Server files never reach a browser bundle. A project file whose name has
 * `.server.` in it (`db.server.ts`, `+droplet.server.ts`, `hooks.server.ts`,
 * `query.server.js`), a `+server.*` route, or any file under a `server/`
 * folder (`src/lib/server/db.ts`) is server code, in any case (`Server/`,
 * `db.SERVER.ts`): the client build fails when
 * its graph reaches one, through any chain, and the dev server refuses the
 * import, naming the chain. One reached as a file rather than a module
 * (`new URL(…, import.meta.url)`, a CSS `url()`, `?url`, `?raw`) fails the
 * build too, inlined or emitted, and the dev server answers 403 when the
 * browser asks for one. Dependencies and the framework's own files are not
 * checked.
 */

const SERVER_NAME = /(?:\.|^\+)server\.[^/]+$/i;
const FRAMEWORK_DIRS = [resolve(packageRoot, "dist"), resolve(packageRoot, "src")];

type CleanInput = { id: string };

function clean({ id }: CleanInput): string {
  return id.replace(/[?#].*$/, "").replaceAll("\\", "/");
}

/**
 * Whether a path names a server file: `.server.` in its name before the
 * extension (`db.server.tsx`, `a.server.mjs`), a `+server.*` route, or a
 * folder on the way named `server`, in any case. `observer.ts`,
 * `webserver.js` and `server-utils/x.ts` are not.
 */
export type IsServerPathInput = { path: string };

export function isServerPath({ path }: IsServerPathInput): boolean {
  const parts = clean({ id: path }).split("/");
  return SERVER_NAME.test(parts.at(-1) ?? "") || parts.slice(0, -1).some((part) => part.toLowerCase() === "server");
}

/**
 * A module id as a path from the project root, for the server file checks;
 * `null` when it is not the project's to check: virtual modules,
 * dependencies, the framework's own files and files outside the project.
 */
export type ProjectPathInput = { root: string; id: string };

export function projectPath({ root, id }: ProjectPathInput): string | null {
  if (id.startsWith("\0") || id.startsWith("virtual:")) return null;
  const file = clean({ id });
  const rel = relative(root, file).replaceAll("\\", "/");
  if (!rel || rel.startsWith("..") || rel.startsWith("/") || /^[a-z]:/i.test(rel)) return null;
  if (rel.split("/").includes("node_modules")) return null;
  if (FRAMEWORK_DIRS.some((dir) => !relative(dir, file).startsWith(".."))) return null;
  return rel;
}

/** Whether a module id is a project server file: by its name or a `server/` folder. */
export function isServerOnlyFile(input: ProjectPathInput): boolean {
  const rel = projectPath(input);
  return rel !== null && isServerPath({ path: rel });
}

/**
 * Whether a project file may import `$droplets/server`, the package's own
 * server entry or `$droplets/env/private`: it is a server file
 * (`isServerPath`: `+server.ts`, `hooks.server.ts`, `db.server.tsx`, a file
 * under a `server/` folder). Files outside the project (dependencies, the
 * framework, virtual modules) are not checked.
 */
export type MayImportServerOnlyInput = { root: string; importer: string };

export function mayImportServerOnly({ root, importer }: MayImportServerOnlyInput): boolean {
  const rel = projectPath({ root, id: importer });
  return rel === null || isServerPath({ path: rel });
}

/** The package's server entry, what `$droplets/server` resolves to: refused wherever that one is. */
export const PACKAGE_SERVER = "@dropletsjs/droplets/server";

export type ServerOnlyImportMessageInput = { id: string; importer: string | undefined };

export function serverOnlyImportMessage({ id, importer }: ServerOnlyImportMessageInput): string {
  return (
    `${id} can only be imported by server files: names with .server. in them (+droplet.server.ts, hooks.server.ts, *.server.*), ` +
    `+server.* routes or files under a server/ folder${importer ? `; imported by ${importer}` : ""}`
  );
}

type ShortInput = { root: string; id: string };

function short({ root, id }: ShortInput): string {
  // A virtual id keeps its query: it says which droplet (`?name=`).
  if (id.startsWith("\0")) return id.slice(1);
  const file = clean({ id });
  const prefix = `${root.replaceAll("\\", "/")}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

type ServerOnlyErrorInput = { root: string; chain: readonly string[]; asFile?: boolean };

export function serverOnlyError({ root, chain, asFile = false }: ServerOnlyErrorInput): Error {
  const file = chain.at(-1);
  if (file === undefined) throw new Error("droplets: an empty import chain");
  const path = asFile
    ? "referenced as a file (new URL(…, import.meta.url), ?url, ?raw or a CSS url())"
    : chain.map((id) => short({ root, id })).join(" -> ");
  return new Error(
    `droplets: ${short({ root, id: file })} is server code and cannot reach the browser: ${path}. ` +
      `Files named *.server.* or under a server/ folder run on the server only: ` +
      `read them from +droplet.server.ts and pass what the browser needs as data.`,
  );
}

type GraphModule = { isEntry?: boolean; importedIds: readonly string[]; dynamicallyImportedIds: readonly string[] };

type FindServerFileInput = {
  root: string;
  moduleIds: Iterable<string>;
  getModule: (id: string) => GraphModule | null;
};

/** The chain from an entry to the first server file in a client build graph; `null` when there is none. */
export function findServerFile({ root, moduleIds, getModule }: FindServerFileInput): string[] | null {
  const ids = [...moduleIds];
  const serverFile = ids.find((id) => isServerOnlyFile({ root, id }));
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
    if (isServerOnlyFile({ root, id: current })) {
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
type ImporterChainInput = { start: DevModule | undefined; importer: string };

function importerChain({ start, importer }: ImporterChainInput): string[] {
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

/** Vite's own test for a Git LFS pointer, which it never inlines. */
const GIT_LFS_PREFIX = Buffer.from("version https://git-lfs.github.com");

type RefuseInlinedInput = { root: string; config: ResolvedConfig; found: Set<string> };

/**
 * A file small enough to inline never reaches `generateBundle` as an asset:
 * the one place Vite names it is the client environment's
 * `assetsInlineLimit`, so that decision refuses a server file and otherwise
 * answers as the user's setting would. It records the file as well, because
 * `new URL(…, import.meta.url)` swallows the error and keeps the URL as it
 * is: `buildEnd` then fails the build.
 */
function refuseInlined({ root, config, found }: RefuseInlinedInput): void {
  const client = config.environments["client"];
  if (!client) return;
  const limit = client.build.assetsInlineLimit;
  client.build.assetsInlineLimit = (file, content) => {
    if (isServerOnlyFile({ root, id: file })) {
      found.add(file);
      throw serverOnlyError({ root, chain: [file], asFile: true });
    }
    if (typeof limit === "function") return limit(file, content);
    const isLfsPointer = content.length >= GIT_LFS_PREFIX.length && GIT_LFS_PREFIX.compare(content, 0, GIT_LFS_PREFIX.length) === 0;
    return content.length < Number(limit) && !isLfsPointer;
  };
}

type RequestedFileInput = { root: string; url: string };

/** The file a dev request names, under the root or through `/@fs/`; `null` when the URL is no path. */
function requestedFile({ root, url }: RequestedFileInput): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    // Not a URL Vite's file server would answer either.
    return null;
  }
  return pathname.startsWith("/@fs/") ? pathname.slice("/@fs".length) : resolve(root, `.${pathname}`);
}

/** Refuses server files in the client environment, in dev and in the build. */
export function serverOnlyPlugin(state: PluginState): Plugin {
  let command: "serve" | "build" = "serve";
  const reachedAsFiles = new Set<string>();
  return {
    name: "droplets:server-only",
    enforce: "pre",
    sharedDuringBuild: true,

    configResolved(config) {
      command = config.command;
      if (command === "build") refuseInlined({ root: state.root, config, found: reachedAsFiles });
    },

    configureServer(server) {
      // Ahead of Vite's file server: a browser fetching `/src/lib/server/x.txt` gets no file.
      server.middlewares.use((req, res, next) => {
        const file = req.url === undefined ? null : requestedFile({ root: state.root, url: req.url });
        if (file === null || !isServerOnlyFile({ root: state.root, id: file })) return next();
        res.statusCode = 403;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end(serverOnlyError({ root: state.root, chain: [file], asFile: true }).message);
      });
    },

    resolveId: {
      order: "pre",
      async handler(source, importer, options) {
        if (!importer || importer.startsWith("\0")) return null;
        // Ahead of Vite's resolver, which would find the package before the virtual plugin sees the id.
        if (
          source === PACKAGE_SERVER &&
          (this.environment.config.consumer === "client" || !mayImportServerOnly({ root: state.root, importer }))
        ) {
          this.error(serverOnlyImportMessage({ id: source, importer }));
        }
        if (command !== "serve" || this.environment.config.consumer !== "client" || source.startsWith("\0")) return null;
        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
        // Only refuses: resolving stays with the other plugins (renderer marks).
        if (!resolved || resolved.external || !isServerOnlyFile({ root: state.root, id: resolved.id })) return null;
        const environment = this.environment;
        const graph = "moduleGraph" in environment ? environment.moduleGraph : undefined;
        const module = graph?.getModuleById(importer) as DevModule | undefined;
        const chain = [...importerChain({ start: module, importer }), resolved.id];
        this.error(serverOnlyError({ root: state.root, chain }).message);
      },
    },

    buildEnd(error) {
      if (error || command !== "build" || this.environment.config.consumer !== "client") return;
      const [asFile] = reachedAsFiles;
      if (asFile !== undefined) this.error(serverOnlyError({ root: state.root, chain: [asFile], asFile: true }).message);
      const chain = findServerFile({ root: state.root, moduleIds: this.getModuleIds(), getModule: (id) => this.getModuleInfo(id) });
      if (chain) this.error(serverOnlyError({ root: state.root, chain }).message);
    },

    generateBundle(_options, bundle) {
      if (this.environment.config.consumer !== "client") return;
      for (const output of Object.values(bundle)) {
        if (output.type !== "asset") continue;
        const file = output.originalFileNames.find((name) => isServerOnlyFile({ root: state.root, id: resolve(state.root, name) }));
        if (file !== undefined) this.error(serverOnlyError({ root: state.root, chain: [resolve(state.root, file)], asFile: true }).message);
      }
    },
  };
}
