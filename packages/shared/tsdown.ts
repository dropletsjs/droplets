// Only `import type` from tsdown: the Dockerfiles install filtered, without the workspace root.
import { readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { UserConfig } from "tsdown";

type Plugin = Extract<NonNullable<UserConfig["plugins"]>, { name: string }>;

/** Any import that is not a path: packages, `node:*`, `virtual:*`, `$droplets/*`. */
export const bareImport = /^(?![./]|[a-zA-Z]:[\\/])/;

export const base: UserConfig = {
  root: "src",
  outDir: "dist",
  format: "esm",
  platform: "neutral",
  target: "es2023",
  fixedExtension: false,
  sourcemap: false,
  clean: true,
  report: false,
  exports: false,
  css: false,
  deps: { neverBundle: [bareImport] },
  dts: { sourcemap: false },
  minify: {
    compress: { keepNames: { function: true, class: true } },
    mangle: { keepNames: { function: true, class: true } },
    codegen: true,
  },
  outputOptions: { comments: { legal: true, annotation: true, jsdoc: false } },
};

/**
 * `import text from "./x.css?inline"` as Vite reads it, the file's text, so
 * the package's tests and its build agree; the built output holds the string.
 */
export function cssInline(): Plugin {
  return {
    name: "droplets:css-inline",
    load: {
      filter: { id: /\.css\?inline$/ },
      handler(id) {
        const file = id.slice(0, -"?inline".length);
        this.addWatchFile(file);
        return { code: readFileSync(file, "utf8"), moduleType: "text" };
      },
    },
  };
}

type IsServerPathInput = { path: string };

/** `*.server.*`, `+server.*`, or anything under a `server/` folder, in any case; a query or hash is ignored. */
export function isServerPath({ path }: IsServerPathInput): boolean {
  const parts = path
    .replace(/[?#].*$/, "")
    .replaceAll("\\", "/")
    .split("/");
  return /(?:\.|^\+)server\.[^/]+$/i.test(parts.at(-1) ?? "") || parts.slice(0, -1).some((part) => part.toLowerCase() === "server");
}

type PackageNameOfInput = { id: string };

/** `@scope/name/sub` → `@scope/name`, `name/sub` → `name`. */
function packageNameOf({ id }: PackageNameOfInput): string {
  return id
    .split("/")
    .slice(0, id.startsWith("@") ? 2 : 1)
    .join("/");
}

type PackageManifest = { name: string; dependencies?: object; peerDependencies?: object };

export type GraphCheckOptions = {
  /** Entries a browser bundle imports, as sources under `src/` without `.ts`. */
  client?: string[];
  /** Server code whose name does not say so: sources under `src/` without `.ts`, or folders (`vite/`). */
  server?: string[];
};

/**
 * Fails the build when a client entry reaches server code or a Node built-in,
 * or when the output imports a package that is not a dependency or peer.
 * Chunks holding server code go to `chunks/server/`.
 */
export function graphCheck({ client = [], server = [] }: GraphCheckOptions = {}): Plugin {
  let src = "";
  let pkg: PackageManifest = { name: "" };

  function isServer(id: string): boolean {
    if (id.startsWith("\0")) return false;
    const path = relative(src, id).replaceAll("\\", "/");
    return isServerPath({ path }) || server.some((name) => (name.endsWith("/") ? path.startsWith(name) : path === `${name}.ts`));
  }

  return {
    name: "droplets:graph-check",
    api: { client, server },
    buildStart({ cwd }) {
      src = resolve(cwd, "src");
      pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    },
    // Before rolldown-plugin-dts, which wraps chunkFileNames to name the `.d.ts` chunks.
    outputOptions: {
      order: "pre",
      handler: (options) => ({
        ...options,
        chunkFileNames: (chunk) => (chunk.moduleIds.some(isServer) ? "chunks/server/[name]-[hash].js" : "chunks/[name]-[hash].js"),
      }),
    },
    generateBundle(_, bundle) {
      const chunks = new Map(Object.values(bundle).flatMap((item) => (item.type === "chunk" ? [[item.fileName, item] as const] : [])));
      const allowed = new Set([pkg.name, ...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);
      for (const chunk of chunks.values()) {
        for (const id of [...chunk.imports, ...chunk.dynamicImports]) {
          if (chunks.has(id) || !bareImport.test(id) || /^(node:|virtual:|\$droplets\/)/.test(id)) continue;
          // A copied file the package imports (`.svelte`) shows up by its name.
          if (statSync(resolve(src, id), { throwIfNoEntry: false })?.isFile()) continue;
          if (!allowed.has(packageNameOf({ id })))
            this.error(`${chunk.fileName} imports ${id}, which is not a dependency or peer dependency of ${pkg.name}`);
        }
      }

      const clientIds = new Set(client.map((name) => resolve(src, `${name}.ts`)));
      for (const entry of chunks.values()) {
        if (!entry.moduleIds.some((id) => clientIds.has(id))) continue;
        const seen = new Set<string>();
        const queue = [[entry.fileName]];
        for (const via of queue) {
          const file = via.at(-1);
          if (file === undefined || seen.has(file)) continue;
          seen.add(file);
          const chunk = chunks.get(file);
          if (!chunk && file.startsWith("node:")) this.error(`client entry ${entry.fileName} imports a Node built-in: ${via.join(" -> ")}`);
          const reached = chunk?.moduleIds.find(isServer);
          if (reached) this.error(`client entry ${entry.fileName} reaches server code ${relative(src, reached)}: ${via.join(" -> ")}`);
          for (const next of chunk ? [...chunk.imports, ...chunk.dynamicImports] : []) queue.push([...via, next]);
        }
      }
    },
  };
}
