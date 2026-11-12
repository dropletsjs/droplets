import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mergeConfig, type UserConfig } from "vite";
import type { DropletsAdapter } from "../adapters.ts";
import { shipsClient, type DropletEntry } from "../core/discover.ts";
import { loadJsonFile, loadTextFile, writeTextFile } from "../core/fs.ts";
import { logger } from "../core/logger.ts";
import { dynamicPublicNames } from "../core/env.ts";
import { entryClientPath, entryServerPath } from "../core/paths.ts";
import type { HydrateMode } from "../renderer.ts";
import { styleImports } from "../runtime/app.ts";
import { locationScript, serverKey } from "../runtime/server-records.ts";
import type { DropletManifestEntry, DropletsManifest } from "../server/manifest.ts";
import { externalsList, type PluginState } from "./state.ts";
import { loadIndexHtml } from "./index-html.ts";
import { clientEntryId, STYLES_PLACEHOLDER, VIRTUAL_CSS } from "./virtual.ts";

/** Named inputs, so the manifest can be read back by name rather than path. */
export const ENTRY_CLIENT_NAME = "entry-client";
export const GLOBAL_CSS_NAME = "droplets-css";
/** What `/index.js` serves: the location record and static imports of the runtime env and the hashed entry. */
export const ENTRY_STUB_FILE = "index.js";
/** What `/index.css` serves: an import of the hashed shared stylesheet, at a fixed URL a page links itself. */
export const STYLE_STUB_FILE = "index.css";

/** The runtime public variables `/index.js` imports, served by the server per request. */
export const ENV_SCRIPT_FILE = "env.js";

/**
 * The element and the registry, cached for good under `/assets/`. Its
 * content carries the build hash, so the name changes with every build,
 * though the droplets' stylesheets are written into it only afterwards.
 * Not named after the build hash itself: `vite build` resolves the config
 * again per environment, with a hash of its own.
 */
export const ENTRY_MODULE_FILE = "assets/index.[hash].js";

/**
 * A droplet's bundle, where its URL says: `/droplets/<id>/client.js`. Its
 * imports are relative (`../../assets/chunks/…`), so they only resolve when
 * the file sits as deep as the URL it is served at.
 */
type DropletClientFileInput = { id: string };

export function dropletClientFile({ id }: DropletClientFileInput): string {
  return `droplets/${id}/client.js`;
}

type DropletStyleFileInput = { id: string };

export function dropletStyleFile({ id }: DropletStyleFileInput): string {
  return `droplets/${id}/style.css`;
}

/**
 * The framework's own runtime dependencies. The user never installed these
 * directly, so they cannot be resolved from the project at runtime; bundling
 * them makes `dist/server.js` depend only on what is in the project's own
 * `package.json` (the UI engine and the droplets' imports). The renderers
 * too: a component's `<renderer>/form` import is compiled and bundled with
 * the renderer's server module, on the same copy of the framework.
 */
export const SERVER_NO_EXTERNAL = [
  "hono",
  /^hono\//,
  "case-anything",
  "@dropletsjs/droplets",
  /^@dropletsjs\/droplets\//,
  /^@dropletsjs\/renderer-/,
];

export type ViteManifestEntry = {
  file?: string;
  name?: string;
  src?: string;
  css?: string[];
  imports?: string[];
};

type CreateClientInputsInput = { entries: readonly DropletEntry[] };

/** One client entry per droplet: each becomes an independently fetched bundle. */
export function createClientInputs({ entries }: CreateClientInputsInput): Record<string, string> {
  const inputs: Record<string, string> = {
    [ENTRY_CLIENT_NAME]: entryClientPath,
    [GLOBAL_CSS_NAME]: VIRTUAL_CSS,
  };
  for (const entry of entries) {
    inputs[`droplets/${entry.id}`] = clientEntryId({ folderName: entry.name });
  }
  return inputs;
}

/** Names of the environments `vite build` may produce, in build order. */
export const BUILD_ENVIRONMENTS = ["client", "ssr", "server"] as const;

/** The adapter, or a clear error when `vite build` runs without one. */
export function requireAdapter(state: PluginState): DropletsAdapter {
  if (!state.adapter) {
    throw new Error(
      "droplets: `vite build` needs an adapter. Install one and pass it to the plugin, e.g.\n" +
        '  import { node } from "@dropletsjs/adapter-node";\n' +
        "  droplets({ adapter: node() })",
    );
  }
  return state.adapter;
}

/** The environments a given adapter needs, in build order. */
export function buildOrder(state: PluginState): Array<(typeof BUILD_ENVIRONMENTS)[number]> {
  // Prerendering runs the SSR bundle at build, whether or not the adapter
  // ships it.
  const needsSsr = requireAdapter(state).separateSsrBundle || state.entries.some((entry) => entry.prerender);
  return needsSsr ? ["client", "ssr", "server"] : ["client", "server"];
}

/**
 * Three environments: the browser bundles, the SSR renderer and the HTTP
 * server. `vite build` builds them in that order via the `buildApp` hook.
 */
export function createBuildEnvironments(state: PluginState): NonNullable<UserConfig["environments"]> {
  const adapter = requireAdapter(state);
  const serverNoExternal = adapter.noExternal === true ? true : [...SERVER_NO_EXTERNAL, ...(adapter.noExternal ?? [])];
  const serverEnvironment: NonNullable<UserConfig["environments"]>[string] = {
    consumer: "server",
    resolve: { noExternal: serverNoExternal },
    build: {
      outDir: state.outDir,
      emptyOutDir: false,
      copyPublicDir: false,
      ssr: adapter.serverEntry,
      rolldownOptions: {
        output: { format: "esm", entryFileNames: adapter.serverFile },
      },
    },
  };
  return {
    client: {
      build: {
        outDir: resolve(state.outDir, "client"),
        emptyOutDir: true,
        // `public/` goes to `assets/public/` (`copyPublicDir`), the only path served.
        copyPublicDir: false,
        manifest: true,
        rolldownOptions: {
          preserveEntrySignatures: "exports-only",
          // `external` comes from the user's own Vite config, merged in.
          input: createClientInputs({ entries: state.entries }),
          output: {
            entryFileNames: (chunk) =>
              chunk.name === ENTRY_CLIENT_NAME ? ENTRY_MODULE_FILE : chunk.name.startsWith("droplets/") ? "[name]/client.js" : "[name].js",
            chunkFileNames: "assets/chunks/[name]-[hash].js",
            assetFileNames: "assets/[name]-[hash][extname]",
          },
        },
      },
    },
    // The SSR renderer: component registry plus the load chain. Built on its
    // own only for adapters whose entry imports it at runtime.
    ssr: {
      consumer: "server",
      resolve: { noExternal: serverNoExternal },
      build: {
        outDir: resolve(state.outDir, "server"),
        emptyOutDir: true,
        copyPublicDir: false,
        ssr: entryServerPath,
        rolldownOptions: {
          output: { format: "esm", entryFileNames: "entry-server.js" },
        },
      },
    },
    // The server itself, as the adapter defines it, emitted next to the
    // bundles above. The adapter's own environment options win.
    server: adapter.environment ? (mergeConfig(serverEnvironment, adapter.environment) as typeof serverEnvironment) : serverEnvironment,
  };
}

/**
 * Every stylesheet an entry needs: those of the chunks it imports, depth
 * first, then its own, each once. A component two droplets share has its
 * styles in its own chunk, which only shows up through `imports`.
 */
type CollectCssInput = { viteManifest: Readonly<Record<string, ViteManifestEntry>>; entry: ViteManifestEntry };

export function collectCss({ viteManifest, entry }: CollectCssInput): string[] {
  const found = new Set<string>();
  const seen = new Set<ViteManifestEntry>();
  const walk = (current: ViteManifestEntry) => {
    if (seen.has(current)) return;
    seen.add(current);
    for (const key of current.imports ?? []) {
      const imported = viteManifest[key];
      if (imported) walk(imported);
    }
    for (const file of current.css ?? []) found.add(file);
  };
  walk(entry);
  return [...found];
}

/**
 * Translates Vite's manifest into the lookup the server uses at runtime:
 * droplet id -> client bundle + every stylesheet it needs.
 */
export type TranslateManifestInput = {
  viteManifest: Readonly<Record<string, ViteManifestEntry>> | null;
  buildHash: string;
  entries: ReadonlyArray<{ id: string; name: string; hydrate?: HydrateMode }>;
  index?: string | null;
  externals?: string[];
  /** `false` when the shared stylesheet came out empty: not worth a request. */
  sharedCss?: boolean;
};

export function translateManifest({
  viteManifest,
  buildHash,
  entries,
  index = null,
  externals = [],
  sharedCss = true,
}: TranslateManifestInput): DropletsManifest {
  // Index by input name: stable, unlike the path-shaped manifest keys.
  const byName = new Map<string, ViteManifestEntry>();
  for (const entry of Object.values(viteManifest ?? {})) {
    if (entry?.name) byName.set(entry.name, entry);
  }

  const lookup = (name: string, fallbackKey: string) => byName.get(name) ?? viteManifest?.[fallbackKey];

  const entryModule = byName.get(ENTRY_CLIENT_NAME)?.file;
  // The shared stylesheet, when the build produced one: first in every
  // droplet's list, so it cascades before the droplet's own.
  const globalCss = lookup(GLOBAL_CSS_NAME, VIRTUAL_CSS)?.css?.[0];
  const droplets: Record<string, DropletManifestEntry> = {};
  for (const entry of entries) {
    const manifestEntry = lookup(`droplets/${entry.id}`, clientEntryId({ folderName: entry.name }));
    const own = manifestEntry && viteManifest ? collectCss({ viteManifest, entry: manifestEntry }) : [];
    const css = [...new Set([...(globalCss && sharedCss ? [globalCss] : []), ...own])];
    droplets[entry.id] = {
      // Built for its stylesheet only when the droplet does not hydrate;
      // the JavaScript is never shipped then.
      ...(shipsClient({ hydrate: entry.hydrate !== false }) ? { client: dropletClientFile({ id: entry.id }) } : {}),
      ...(css.length ? { css } : {}),
    };
  }

  return {
    __hash: buildHash,
    __globalCss: globalCss ?? `assets/${GLOBAL_CSS_NAME}.css`,
    __globalStyle: STYLE_STUB_FILE,
    __entryClient: ENTRY_STUB_FILE,
    ...(entryModule ? { __entryModule: entryModule } : {}),
    __index: index,
    __externals: externals,
    droplets,
  };
}

type GlobalStyleImportInput = { file: string };

/** `/index.css`: an import of the hashed shared stylesheet, relative to itself, so it resolves under any origin or prefix. */
export function globalStyleImport({ file }: GlobalStyleImportInput): string {
  return `@import url(${JSON.stringify(`./${file}`)});\n`;
}

type EntryStubCodeInput = { entryModule: string; key: string; hasRuntimeEnv: boolean };

/**
 * `/index.js`: static imports, so the browser fetches `env.js` and the entry
 * at once and evaluates `env.js` first. The location record is written after
 * the entry has run; the element reads the location lazily and, until then,
 * finds the same one from the entry's own URL (`serverLocation`).
 */
export function entryStubCode({ entryModule, key, hasRuntimeEnv }: EntryStubCodeInput): string {
  const env = hasRuntimeEnv ? `import ${JSON.stringify(`./${ENV_SCRIPT_FILE}`)};\n` : "";
  return `${env}import ${JSON.stringify(`./${entryModule}`)};\n${locationScript(key)}`;
}

/** The droplets' stylesheets, written into the entry where the registry left room. */
type FillStylesInput = { code: string; droplets: DropletsManifest["droplets"] };

export function fillStyles({ code, droplets }: FillStylesInput): string {
  const styles: Record<string, string[]> = {};
  for (const [id, entry] of Object.entries(droplets)) {
    if (entry.css?.length) styles[id] = entry.css;
  }
  let filled = false;
  const result = code.replace(new RegExp(`(["'\`])${STYLES_PLACEHOLDER}\\1`), () => {
    filled = true;
    return JSON.stringify(JSON.stringify(styles));
  });
  if (!filled) throw new Error("droplets: the entry client has no room for the droplets' stylesheets");
  return result;
}

/**
 * Reads Vite's client manifest and writes `dist/client/droplets.json`, the
 * stub `/index.js` serves, and the droplets' stylesheets into the entry.
 */
export async function writeManifest(state: PluginState): Promise<string> {
  const clientRoot = resolve(state.outDir, "client");
  const viteManifest = await loadJsonFile<Record<string, ViteManifestEntry>>({ path: resolve(clientRoot, ".vite/manifest.json") });
  if (!viteManifest) {
    logger.warn("framework", "vite manifest missing; CSS paths will fall back and /index.js has no entry");
  }

  const index = await loadIndexHtml({ root: state.root, index: state.config.index });
  const translate = (sharedCss: boolean) =>
    translateManifest({
      viteManifest,
      buildHash: state.buildHash,
      entries: state.entries,
      index,
      externals: externalsList(state),
      sharedCss,
    });
  const full = translate(true);
  // Nothing to share (no stylesheet, no Tailwind): no droplet asks for it, and the file is not kept.
  const sharedCss = Boolean((await loadTextFile({ path: resolve(clientRoot, full.__globalCss) }))?.trim());
  const manifest = sharedCss ? full : translate(false);
  if (!sharedCss) await rm(resolve(clientRoot, full.__globalCss), { force: true });
  // The shared stylesheet's entry has no JavaScript: its chunk is empty.
  const cssChunk = Object.values(viteManifest ?? {}).find((entry) => entry?.name === GLOBAL_CSS_NAME)?.file;
  if (cssChunk && (await loadTextFile({ path: resolve(clientRoot, cssChunk) })) === "") {
    await rm(resolve(clientRoot, cssChunk), { force: true });
  }
  // A droplet that never runs in the browser goes through the client build
  // only so its <style> is extracted. Its JavaScript is removed from the output.
  for (const entry of state.entries) {
    if (shipsClient(entry)) continue;
    await rm(resolve(clientRoot, dropletClientFile({ id: entry.id }), ".."), { recursive: true, force: true });
  }
  // What `/droplets/<id>/style.css` and `/index.css` answer, as files for a host that serves files first.
  for (const [id, { css }] of Object.entries(manifest.droplets)) {
    if (css?.length) await writeTextFile({ path: resolve(clientRoot, dropletStyleFile({ id })), contents: styleImports({ files: css }) });
  }
  if (sharedCss) {
    await writeTextFile({ path: resolve(clientRoot, manifest.__globalStyle), contents: globalStyleImport({ file: manifest.__globalCss }) });
  }

  if (manifest.__entryModule) {
    const entryPath = resolve(clientRoot, manifest.__entryModule);
    await writeFile(entryPath, fillStyles({ code: await readFile(entryPath, "utf8"), droplets: manifest.droplets }));
    await writeTextFile({
      path: resolve(clientRoot, manifest.__entryClient),
      contents: entryStubCode({
        entryModule: manifest.__entryModule,
        key: serverKey(state.config.element, state.buildHash),
        hasRuntimeEnv: dynamicPublicNames(state.env).length > 0,
      }),
    });
  }

  const manifestPath = resolve(clientRoot, "droplets.json");
  await writeTextFile({ path: manifestPath, contents: `${JSON.stringify(manifest, null, 2)}\n` });
  logger.debug("framework", "wrote droplet manifest", {
    path: manifestPath,
    droplets: Object.keys(manifest.droplets),
  });
  return manifestPath;
}
