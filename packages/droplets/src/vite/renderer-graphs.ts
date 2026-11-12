import { resolve } from "node:path";
import type { Plugin } from "vite";
import type { DropletEntry } from "../core/discover.ts";
import { RENDERER_QUERY, type DropletRenderer } from "../renderer.ts";
import { isScriptDroplet, userRenderers } from "../script/index.ts";
import type { PluginState } from "./state.ts";

/**
 * Several UI engines in one project. Each droplet is written for one
 * renderer, and so is everything it imports:
 *
 * - When two renderers claim one extension (React and Solid, `.tsx`), the
 *   modules a droplet reaches are marked with its renderer, a
 *   `?droplets-renderer=<name>` query that spreads from importer to import.
 *   Each renderer's plugins compile only their own marks, so a shared
 *   `lib/Button.tsx` is compiled once per renderer that uses it.
 * - A droplet that reaches another engine's own modules (`.svelte`,
 *   `.svelte.ts`, `.vue`, the `react` or `solid-js` packages, …) fails the
 *   build, and the dev server shows the error. Neutral code is shared. A
 *   script droplet (`+droplet.script.ts`) is not checked: it may import
 *   anything.
 * - Styles belong to the component. CSS reached from a load module
 *   (`+droplet.ts`, `+droplet.server.ts`), directly or through what it
 *   imports, fails the same way. `?url`, `?raw` and `?inline` imports are
 *   strings, not styles, and pass.
 */

/** Script modules the mark spreads through. */
const SCRIPT = /\.[mc]?[jt]sx?$/;
const MARK = new RegExp(`[?&]${RENDERER_QUERY}=([^&]+)`);

type IdInput = { id: string };

function clean({ id }: IdInput): string {
  return id.replace(/[?#].*$/, "").replaceAll("\\", "/");
}

/** Vite's stylesheet languages, as a module id or a query that ends in one (`?lang.css`). */
const STYLESHEET = /\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/;
// `?transform-only` is the file behind a `?url` import in a build: emitted, never injected.
const AS_STRING = /[?&](?:url|raw|inline|transform-only)(?:&|$)/;

/** Whether a module id is a stylesheet that styles the page. */
export function isStylesheet({ id }: IdInput): boolean {
  return STYLESHEET.test(id.replaceAll("\\", "/")) && !AS_STRING.test(id);
}

/** The renderer a module is marked with, if any. */
export function markOf({ id }: IdInput): string | null {
  return id.match(MARK)?.[1] ?? null;
}

export type ComponentSpecifierInput = { path: string; renderer: string; shared: ReadonlySet<string> };

/** A component import, marked when its renderer shares an extension. */
export function componentSpecifier({ path, renderer, shared }: ComponentSpecifierInput): string {
  return shared.has(renderer) ? `${path}?${RENDERER_QUERY}=${renderer}` : path;
}

/**
 * The renderers a module belongs to: by its suffix (component extensions
 * and the renderer's `suffixes`) or its package. Empty for neutral code.
 */
export type OwnersOfInput = { id: string; renderers: readonly DropletRenderer[] };

export function ownersOf({ id, renderers }: OwnersOfInput): string[] {
  const file = clean({ id });
  return renderers
    .filter(
      (renderer) =>
        [...renderer.extensions, ...(renderer.suffixes ?? [])].some((suffix) => file.endsWith(suffix)) ||
        (renderer.packages ?? []).some((pkg) => inPackage({ file, pkg })),
    )
    .map((renderer) => renderer.name);
}

/**
 * Whether a resolved file belongs to `pkg`. A subpath (`hono/jsx`) owns the
 * folder of that name anywhere in the package, however it lays out its
 * builds: `hono/dist/jsx/dom/index.js`.
 */
type InPackageInput = { file: string; pkg: string };

function inPackage({ file, pkg }: InPackageInput): boolean {
  const name = packageOf({ specifier: pkg });
  if (!name || name === pkg) return file.includes(`/node_modules/${pkg}/`);
  const sub = pkg.slice(name.length + 1);
  return new RegExp(`/node_modules/${escapeRegExp({ text: name })}/(?:[^/]+/)*${escapeRegExp({ text: sub })}/`).test(file);
}

type EscapeRegExpInput = { text: string };

function escapeRegExp({ text }: EscapeRegExpInput): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The package a bare specifier names: `solid-js/web` -> `solid-js`, `@scope/pkg/x` -> `@scope/pkg`. */
type PackageOfInput = { specifier: string };

function packageOf({ specifier }: PackageOfInput): string | null {
  if (/^[./\\]|^[a-z]+:/i.test(specifier) || specifier.startsWith("$")) return null;
  const parts = specifier.split("/");
  const [first = ""] = parts;
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : first;
}

/**
 * The renderers an import belongs to, by what it resolved to or by the
 * package it names: the dev server hands out pre-bundled copies
 * (`node_modules/.vite/deps/solid-js.js`) whose path says nothing.
 */
export type OwnersOfImportInput = { source: string; resolved: string; renderers: readonly DropletRenderer[] };

export function ownersOfImport({ source, resolved, renderers }: OwnersOfImportInput): string[] {
  const byPackage = packageOf({ specifier: source })
    ? renderers
        .filter((renderer) => renderer.packages?.some((pkg) => source === pkg || source.startsWith(`${pkg}/`)))
        .map((renderer) => renderer.name)
    : [];
  return [...new Set([...ownersOf({ id: resolved, renderers }), ...byPackage])];
}

/**
 * The renderers whose modules are checked. A script droplet is plain
 * JavaScript that may bring in anything (a third-party widget, whatever it
 * is built on): it owns nothing, and nothing it imports is foreign to it.
 */
function checked(state: PluginState): DropletRenderer[] {
  return userRenderers({ renderers: state.renderers });
}

/** Absolute component paths (droplet and error page) to their renderer; script droplets are not checked. */
function componentRenderers(state: PluginState): Map<string, string> {
  const map = new Map<string, string>();
  const add = (entry: DropletEntry, file: string | undefined) => {
    if (file) map.set(resolve(state.dropletsRoot, entry.name, file).replaceAll("\\", "/"), entry.renderer);
  };
  for (const entry of state.entries) {
    if (isScriptDroplet(entry)) continue;
    add(entry, entry.file);
    add(entry, entry.errorFile);
  }
  return map;
}

type ShortInput = { root: string; id: string };

function short({ root, id }: ShortInput): string {
  const file = clean({ id });
  const pkg = file.lastIndexOf("/node_modules/");
  if (pkg !== -1) return file.slice(pkg + "/node_modules/".length);
  const prefix = `${root.replaceAll("\\", "/")}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

type ChainTextInput = { root: string; chain: readonly string[] };

/** The chain as the user reads it: a file's sub-modules (`+droplet.vue?vue&type=script`) fold into the file. */
function chainText({ root, chain }: ChainTextInput): string {
  const files = chain.map((id) => short({ root, id }));
  return files.filter((file, i) => i === 0 || file !== files[i - 1]).join(" -> ");
}

type CrossImportErrorInput = {
  root: string;
  renderer: string;
  chain: readonly string[];
  owners: readonly string[];
};

function crossImportError({ root, renderer, chain, owners }: CrossImportErrorInput): Error {
  const path = chainText({ root, chain });
  return new Error(
    `droplets: a ${renderer} droplet imports ${owners.join("/")} code: ${path}. ` +
      `A droplet uses its own framework's modules and neutral code only.`,
  );
}

/** Absolute load module paths (`+droplet.ts`, `+droplet.server.ts`) to their droplet folder. */
function loadModules(state: PluginState): Map<string, string> {
  const map = new Map<string, string>();
  const add = (entry: DropletEntry, file: string) =>
    map.set(resolve(state.dropletsRoot, entry.name, file).replaceAll("\\", "/"), entry.name);
  for (const entry of state.entries) {
    if (entry.hasLoad) add(entry, "+droplet.ts");
    if (entry.hasServerLoad) add(entry, "+droplet.server.ts");
  }
  return map;
}

type LoadCssErrorInput = { root: string; chain: readonly [string, ...string[]] };

function loadCssError({ root, chain }: LoadCssErrorInput): Error {
  const path = chainText({ root, chain });
  return new Error(
    `droplets: ${short({ root, id: chain[0] })} imports CSS: ${path}. ` +
      `Styles belong to the component: import them from +droplet.<ext> or +error.<ext> (or a <style> block).`,
  );
}

type GraphModule = { importedIds: readonly string[]; dynamicallyImportedIds: readonly string[] };

type FindInGraphInput = {
  start: string;
  getModule: (id: string) => GraphModule | null;
  isTarget: (id: string) => boolean;
};

/** The path from `start` to the first module `isTarget` accepts, through the graph; `null` when none does. */
function findInGraph({ start, getModule, isTarget }: FindInGraphInput): [string, ...string[]] | null {
  const parent = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (isTarget(current)) {
      const chain: [string, ...string[]] = [current];
      for (let at = parent.get(current) ?? null; at; at = parent.get(at) ?? null) chain.unshift(at);
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
  return null;
}

/**
 * Walks every droplet's module graph after a build and fails on the first
 * module another renderer owns, naming the import chain.
 */
export type CheckDropletGraphsInput = {
  state: PluginState;
  moduleIds: Iterable<string>;
  getModule: (id: string) => GraphModule | null;
};

export function checkDropletGraphs({ state, moduleIds, getModule }: CheckDropletGraphsInput): void {
  const components = componentRenderers(state);
  const loads = loadModules(state);
  const { root } = state;
  for (const id of moduleIds) {
    const renderer = components.get(clean({ id }));
    if (renderer) {
      const isForeign = (current: string) => {
        const owners = ownersOf({ id: current, renderers: checked(state) });
        return owners.length > 0 && !owners.includes(renderer);
      };
      const chain = findInGraph({ start: id, getModule, isTarget: isForeign });
      const last = chain?.at(-1);
      if (chain && last !== undefined) {
        throw crossImportError({ root, renderer, chain, owners: ownersOf({ id: last, renderers: checked(state) }) });
      }
    }
    if (loads.has(clean({ id }))) {
      const chain = findInGraph({ start: id, getModule, isTarget: (current) => isStylesheet({ id: current }) });
      if (chain) throw loadCssError({ root, chain });
    }
  }
}

type DevModule = { id: string | null; importers: Set<DevModule> };

/** The first load module that reaches `id` through the dev module graph, `id` itself included. */
type ReachingLoadInput = { loads: ReadonlyMap<string, string>; start: DevModule | undefined; id: string };

function reachingLoad({ loads, start, id }: ReachingLoadInput): string | undefined {
  if (loads.has(clean({ id }))) return id;
  const seen = new Set<DevModule>();
  const queue = start ? [start] : [];
  while (queue.length > 0) {
    const module = queue.shift();
    if (module === undefined) break;
    if (seen.has(module)) continue;
    seen.add(module);
    if (module.id && loads.has(clean({ id: module.id }))) return module.id;
    queue.push(...module.importers);
  }
  return undefined;
}

/** The renderers of the droplets that reach `id`, through the dev module graph. */
type ReachingRenderersInput = { components: ReadonlyMap<string, string>; start: DevModule | undefined; id: string };

function reachingRenderers({ components, start, id }: ReachingRenderersInput): Set<string> {
  const found = new Set<string>();
  const direct = components.get(clean({ id }));
  if (direct) found.add(direct);
  const marked = markOf({ id });
  if (marked) found.add(marked);
  const seen = new Set<DevModule>();
  const queue = start ? [start] : [];
  while (queue.length > 0) {
    const module = queue.shift();
    if (module === undefined) break;
    if (seen.has(module)) continue;
    seen.add(module);
    const renderer = module.id ? components.get(clean({ id: module.id })) : undefined;
    if (renderer) found.add(renderer);
    queue.push(...module.importers);
  }
  return found;
}

/** The core plugin that marks modules and checks cross-framework imports. */
export function rendererGraphsPlugin(state: PluginState): Plugin {
  let command: "serve" | "build" = "serve";

  return {
    name: "droplets:renderer-graphs",
    enforce: "pre",
    sharedDuringBuild: true,

    configResolved(config) {
      command = config.command;
    },

    resolveId: {
      order: "pre",
      async handler(source, importer, options) {
        if (!importer || source.startsWith("\0") || importer.startsWith("\0")) return null;
        const mark = markOf({ id: importer });
        const checking = command === "serve" && !clean({ id: importer }).includes("/node_modules/");
        if (!mark && !checking) return null;

        if (checking && isStylesheet({ id: source })) {
          // The build walks whole graphs; the dev server checks each import as it is resolved.
          const environment = this.environment;
          const graph = environment && "moduleGraph" in environment ? environment.moduleGraph : undefined;
          const module = graph?.getModuleById(importer) as DevModule | undefined;
          const load = reachingLoad({ loads: loadModules(state), start: module, id: importer });
          if (load) {
            const chain: [string, ...string[]] = load === importer ? [importer, source] : [load, importer, source];
            this.error(loadCssError({ root: state.root, chain }).message);
          }
        }
        if (source.includes("?")) return null;

        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
        if (!resolved || resolved.external || resolved.id.startsWith("\0")) return resolved;

        if (checking) {
          // The build walks whole graphs; the dev server checks each import as it is resolved.
          const owners = ownersOfImport({ source, resolved: resolved.id, renderers: checked(state) });
          if (owners.length > 0) {
            const environment = this.environment;
            const graph = environment && "moduleGraph" in environment ? environment.moduleGraph : undefined;
            const module = graph?.getModuleById(importer) as DevModule | undefined;
            const renderers = reachingRenderers({ components: componentRenderers(state), start: module, id: importer });
            for (const renderer of renderers) {
              if (!owners.includes(renderer)) {
                const target = packageOf({ specifier: source }) ? source : resolved.id;
                this.error(crossImportError({ root: state.root, renderer, chain: [importer, target], owners }).message);
              }
            }
          }
        }

        // A renderer's own packages (`@…/renderer-solid/form`) are
        // built code and must stay one module: `/form` shares a context with
        // the renderer's server module. In a workspace they resolve outside
        // node_modules, so the path alone does not tell.
        const rendererPackage =
          packageOf({ specifier: source }) !== null &&
          state.renderers.some((r) => r.packages?.some((pkg) => source === pkg || source.startsWith(`${pkg}/`)));
        if (!mark || rendererPackage || resolved.id.includes("?") || !SCRIPT.test(resolved.id) || resolved.id.includes("/node_modules/")) {
          return resolved;
        }
        return { ...resolved, id: `${resolved.id}?${RENDERER_QUERY}=${mark}` };
      },
    },

    buildEnd(error) {
      // Every build: the client one has the components and +droplet.ts, the
      // SSR one (or the server one, without it) +droplet.server.ts too.
      if (error || command !== "build") return;
      checkDropletGraphs({ state, moduleIds: this.getModuleIds(), getModule: (id) => this.getModuleInfo(id) });
    },
  };
}
