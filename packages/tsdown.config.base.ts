/**
 * The tsdown config every published package builds with: each package's
 * `tsdown.config.ts` exports its `options` and `packageConfig(options)`. It
 * sits in `packages/` so the Dockerfiles that copy `packages` carry it.
 *
 * - ESM only, `.js`, into `dist/`; each entry at a fixed path named after its
 *   source (`src/runtime/entry-client.ts` -> `dist/runtime/entry-client.js`),
 *   since the Vite plugin and the renderers resolve those files by path.
 *   Code entries share goes to `dist/chunks/`, or `dist/chunks/server/` when
 *   it holds server code.
 * - Nothing from `node_modules` is bundled: every bare import (`vite`,
 *   `hono`, the framework, `virtual:*`, `$droplets/*`, `node:*`) stays an
 *   import for the consumer's Vite or Node to resolve, and the build fails on
 *   one that is not a dependency or peer of the package.
 * - Minified (whitespace, syntax, mangled locals), with function and class
 *   names kept for errors and stack traces, `@vite-ignore` and `@__PURE__`
 *   annotations kept, and no source maps. `import.meta.env.DEV` and
 *   `import.meta.hot` are left as written: the consumer's Vite replaces them.
 * - `.d.ts` per entry, with their JSDoc.
 * - `import text from "./x.css"` inlines the file's text as a string.
 * - Server code never reaches the client: `client` names the entries a
 *   browser bundle imports, and the build fails when what they import,
 *   through any chain, holds a server module or imports a Node built-in.
 *
 * Only `import type` from tsdown here, so the config loads in a package
 * without the workspace root installed (the Dockerfiles install filtered).
 */
import { readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import type { UserConfig } from "tsdown";

/** A Rolldown plugin, as far as this file needs one. */
type Plugin = Extract<NonNullable<UserConfig["plugins"]>, { name: string }>;

export type PackageOptions = {
  /** The package directory: `import.meta.dirname` of its `tsdown.config.ts`. */
  dir: string;
  /** Sources under `src/`, without `.ts`: `["index", "runtime/server"]`. Each builds to `dist/<name>.js`. */
  entry: string[];
  /** The entries a browser bundle imports: what they reach holds no server module. */
  client?: string[];
  /**
   * Sources under `src/`, without `.ts`, that are server code although their
   * names do not say so (`runtime/app`), or folders of them (`vite/`).
   * `*.server.*` files and those under a `server/` folder are server code by
   * name.
   */
  server?: string[];
  /**
   * Files under `src/` shipped as they are, next to the built entries:
   * `.svelte` components, hand-written `.js` with its `.d.ts`. An import of
   * one stays an import, of the shipped copy.
   */
  asIs?: string[];
};

const BARE = /^(?![./]|[a-zA-Z]:[\\/])/;

/** Whether a path names server code: `.server.` in its name, or a `server/` folder on its way. */
export function isServerPath(path: string): boolean {
  const parts = path.replace(/[?#].*$/, "").replaceAll("\\", "/").split("/");
  return /(?:\.|^\+)server\.[^/]+$/.test(parts.at(-1) ?? "") || parts.slice(0, -1).includes("server");
}

/** Whether a module id is one of the package's server modules. */
function serverMatcher(src: string, server: string[]): (id: string) => boolean {
  const folders = server.filter((name) => name.endsWith("/")).map((name) => resolve(src, name) + "/");
  const ids = new Set(server.filter((name) => !name.endsWith("/")).map((name) => resolve(src, `${name}.ts`)));
  return (id) =>
    !id.startsWith("\0") &&
    (ids.has(id) || folders.some((folder) => id.startsWith(folder)) || isServerPath(relative(src, id)));
}

/**
 * Fails the build when a client entry reaches a server module or a Node
 * built-in through its chunks: their static and dynamic imports, any depth.
 */
function clientGraphPlugin(src: string, client: string[], isServer: (id: string) => boolean): Plugin {
  const clientIds = new Set(client.map((name) => resolve(src, `${name}.ts`)));
  return {
    name: "droplets:client-graph",
    generateBundle(_, bundle) {
      const chunks = new Map<string, { fileName: string; moduleIds: string[]; imports: string[]; dynamicImports: string[] }>();
      for (const item of Object.values(bundle)) if (item.type === "chunk") chunks.set(item.fileName, item);
      for (const entry of chunks.values()) {
        if (!entry.moduleIds.some((id) => clientIds.has(id))) continue;
        const seen = new Set<string>();
        const queue = [[entry.fileName]];
        for (let via = queue.shift(); via; via = queue.shift()) {
          const file = via.at(-1)!;
          if (seen.has(file)) continue;
          seen.add(file);
          const chunk = chunks.get(file);
          if (!chunk) {
            if (file.startsWith("node:")) this.error(`client entry ${entry.fileName} imports a Node built-in: ${via.join(" -> ")}`);
            continue;
          }
          const server = chunk.moduleIds.find(isServer);
          if (server) this.error(`client entry ${entry.fileName} reaches server code ${relative(src, server)}: ${via.join(" -> ")}`);
          for (const next of [...chunk.imports, ...chunk.dynamicImports]) queue.push([...via, next]);
        }
      }
    },
  };
}

/** `@scope/name/sub` -> `@scope/name`, `name/sub` -> `name`. */
const packageName = (id: string) => id.split("/").slice(0, id.startsWith("@") ? 2 : 1).join("/");

/**
 * Fails the build when the output imports a package the consumer may not
 * have: everything bare must be a dependency or peer of the package (or the
 * package itself), a Node built-in, a `virtual:` module or `$droplets/*`.
 * An `asIs` file, imported relatively, shows up here by its name.
 */
function importsPlugin(dir: string, asIs: string[]): Plugin {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
    name: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const allowed = new Set([pkg.name, ...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);
  return {
    name: "droplets:imports",
    generateBundle(_, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk") continue;
        for (const id of [...item.imports, ...item.dynamicImports]) {
          if (id in bundle || asIs.includes(id) || !BARE.test(id) || /^(node:|virtual:|\$droplets\/)/.test(id)) continue;
          if (!allowed.has(packageName(id))) {
            this.error(`${item.fileName} imports ${id}, which is not a dependency or peer dependency of ${pkg.name}`);
          }
        }
      }
    },
  };
}

/** The tsdown config of one published package. */
export function packageConfig(options: PackageOptions): UserConfig {
  const src = resolve(options.dir, "src");
  const asIs = (options.asIs ?? []).map((file) => resolve(src, file));
  const isServer = serverMatcher(src, options.server ?? []);
  return {
    cwd: options.dir,
    // Absolute, so the `.d.ts` keep the entry names (and folders) too.
    entry: Object.fromEntries(options.entry.map((name) => [name, resolve(src, extname(name) ? name : `${name}.ts`)])),
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
    dts: { sourcemap: false },
    loader: { ".css": "text" },
    deps: {
      neverBundle: (id: string, importer: string | undefined) => {
        // Oxc's helpers are part of our output (a tagged template that holds
        // `</script>` needs one), not a dependency.
        if (id.startsWith("@oxc-project/runtime/")) return false;
        if (BARE.test(id)) return true;
        if (!importer || !id.startsWith(".")) return false;
        return asIs.includes(resolve(dirname(importer), id));
      },
      onlyBundle: false,
    },
    minify: {
      compress: { keepNames: { function: true, class: true } },
      mangle: { keepNames: { function: true, class: true } },
      codegen: true,
    },
    outputOptions: {
      chunkFileNames: (chunk) => (chunk.moduleIds.some(isServer) ? "chunks/server/[name]-[hash].js" : "chunks/[name]-[hash].js"),
      comments: { legal: true, annotation: true, jsdoc: false },
    },
    copy: asIs.map((file) => ({ from: file, to: join(options.dir, "dist", dirname(relative(src, file))) })),
    plugins: [clientGraphPlugin(src, options.client ?? [], isServer), importsPlugin(options.dir, options.asIs ?? [])],
  };
}
