import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { kebabCase } from "case-anything";
import { fileExists, listDirectories, readTextFile } from "./fs.ts";
import { logger } from "./logger.ts";
import {
  CORE_SUFFIXES,
  noRendererMessage,
  pickRenderer,
  readExportedFlags,
  SCRIPT_RENDERER,
  validateRenderers,
  withFlagDefaults,
  type ComponentKind,
  type DropletRenderer,
  type HydrateMode,
  type RenderFlags,
} from "../renderer.ts";

export type { RenderFlags } from "../renderer.ts";

export type DropletEntry = {
  /** Route id, kebab-cased from the folder name. */
  id: string;
  /** Folder name on disk, which may differ in case from the id. */
  name: string;
  /** The component's file name inside the folder: `+droplet.svelte`, `+Droplet.vue`. */
  file: string;
  /** Name of the renderer that handles `file`. */
  renderer: string;
  hasLoad: boolean;
  hasServerLoad: boolean;
  /** Has an error page (`+error.<ext>`), rendered when a load fails. */
  hasError: boolean;
  /** The error page's file name, in the droplet's framework; set with `hasError`. */
  errorFile?: string;
  ssr: boolean;
  hydrate: HydrateMode;
  /** Rendered at build time for `entries` from `+droplet.server.ts`. */
  prerender: boolean;
};

/** Folder name -> route id. `HelloWorld` -> `hello-world`. */
export function dropletId(folderName: string): string {
  return kebabCase(folderName);
}

/** The flags a component's source declares, with their defaults, through the default reader. */
export function readRenderFlags(source: string, droplet: string): RenderFlags {
  return withFlagDefaults(readExportedFlags(source, droplet));
}

/** Whether the droplet ships a browser bundle: it hydrates, its error page with it. */
export function shipsClient(entry: Pick<DropletEntry, "hydrate">): boolean {
  return entry.hydrate !== false;
}

/** `+droplet.vue` -> `.vue`; `+Droplet.fake.js` -> `.fake.js`; anything else -> `null`. */
function componentSuffix(fileName: string, kind: ComponentKind): string | null {
  const prefix = kind === "droplet" ? /^\+[Dd]roplet(\..+)$/ : /^\+[Ee]rror(\..+)$/;
  const match = fileName.match(prefix);
  const suffix = match?.[1];
  if (!suffix || CORE_SUFFIXES.has(suffix)) return null;
  return suffix;
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

type Found = { file: string; renderer: DropletRenderer; flags: RenderFlags };

export type DiscoverOptions = {
  /** The dev server: flags an error page declares are reported, once each. */
  dev?: boolean;
};

/** Error pages already reported, so a rescan stays quiet. */
const reported = new Set<string>();

/** In dev, says why an error page is not taken as it is, once per file and reason. */
function report(options: DiscoverOptions, key: string, message: string): void {
  if (!options.dev || reported.has(key)) return;
  reported.add(key);
  logger.warn("framework", message);
}

/**
 * The one `+droplet.*` (or `+error.*`) file of a folder, with its renderer
 * and flags. Two such files are an error; a suffix no renderer handles is
 * an error too. The error page is the droplet's error boundary: written in
 * the droplet's framework (`framework`), it follows the droplet's flags. An
 * error page in another framework, and flags it declares, are ignored, with
 * a warning in dev.
 */
async function findComponent(
  kind: ComponentKind,
  folderName: string,
  folder: string,
  files: string[],
  byExtension: Map<string, DropletRenderer[]>,
  droplet: string,
  options: DiscoverOptions,
  framework?: DropletRenderer,
): Promise<Found | null> {
  const handlers = (f: string) => byExtension.get(componentSuffix(f, kind)!) ?? [];
  let candidates = files.filter((f) => componentSuffix(f, kind) !== null);
  if (framework) {
    const other = (f: string) => `${folderName}/${f} is not a ${framework.name} component like the droplet; ignored, ` +
      "the error page is written in the droplet's framework";
    for (const f of candidates.filter((f) => !handlers(f).includes(framework))) {
      report(options, `${folder}/${f}:framework`, other(f));
    }
    candidates = candidates.filter((f) => handlers(f).includes(framework));
    if (candidates.length === 1 && handlers(candidates[0]!).length > 1) {
      // A suffix another renderer shares: the error page's imports decide.
      const source = (await readTextFile(resolve(folder, candidates[0]!))) ?? "";
      const picked = pickRenderer(handlers(candidates[0]!), source, `${folderName}/${candidates[0]}`, framework);
      if (picked !== framework) {
        report(options, `${folder}/${candidates[0]}:framework`, other(candidates[0]!));
        return null;
      }
    }
  }
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    throw new Error(
      `droplets: ${folderName}/ has ${candidates.length} ${kind} components (${candidates.join(", ")}); keep one`,
    );
  }
  const file = candidates[0]!;
  const suffix = componentSuffix(file, kind)!;
  const group = byExtension.get(suffix);
  if (!group) throw new Error(`droplets: ${noRendererMessage(`${folderName}/${file}`, suffix)}`);

  const source = (await readTextFile(resolve(folder, file))) ?? "";
  const renderer = pickRenderer(group, source, `${folderName}/${file}`, framework);
  const where = kind === "droplet" ? droplet : `${droplet}/${file}`;
  const declared = renderer.readFlags
    ? await renderer.readFlags({
      kind,
      source,
      file,
      folder,
      droplet,
      readFile: (name) => readTextFile(resolve(folder, name)),
    })
    : readExportedFlags(source, where);
  if (kind === "error") {
    const own = Object.keys(declared ?? {});
    if (own.length > 0) {
      report(
        options,
        `${folder}/${file}:${own.join(",")}`,
        `${folderName}/${file} declares ${own.map((name) => `"${name}"`).join(", ")}; ignored, ` +
          "+error.* follows the droplet's ssr, hydrate and prerender",
      );
    }
    return { file, renderer, flags: withFlagDefaults(undefined) };
  }
  return { file, renderer, flags: withFlagDefaults(declared) };
}

/**
 * Finds every `<folder>/+droplet.<ext>` under `dropletsRoot`, picks the
 * renderer for each by extension and reads its build-time flags. The single
 * source of truth for which droplets exist: the Vite plugin, the production
 * build and the dev server all use it.
 */
export async function discoverDroplets(
  dropletsRoot: string,
  renderers: DropletRenderer[] = [],
  options: DiscoverOptions = {},
): Promise<DropletEntry[]> {
  const byExtension = validateRenderers(renderers);
  const entries: DropletEntry[] = [];
  const seen = new Set<string>();

  for (const name of await listDirectories(dropletsRoot)) {
    const folder = resolve(dropletsRoot, name);
    const files = await listFiles(folder);
    const id = dropletId(name);
    const component = await findComponent("droplet", name, folder, files, byExtension, id, options);
    if (!component) continue;

    if (seen.has(id)) {
      logger.warn("framework", "duplicate droplet id; skipping folder", { id, folder: name });
      continue;
    }
    seen.add(id);

    // One framework per droplet: an error page in another one is ignored.
    // A script droplet has none: it renders nothing, on either side.
    const script = component.renderer.name === SCRIPT_RENDERER;
    if (script) {
      for (const f of files.filter((f) => componentSuffix(f, "error") !== null)) {
        report(options, `${folder}/${f}:script`, `${name}/${f} is ignored: a script droplet has no error page`);
      }
    }
    const error = script
      ? null
      : await findComponent("error", name, folder, files, byExtension, id, options, component.renderer);
    entries.push({
      id,
      name,
      file: component.file,
      renderer: component.renderer.name,
      hasLoad: await fileExists(resolve(folder, "+droplet.ts")),
      hasServerLoad: await fileExists(resolve(folder, "+droplet.server.ts")),
      hasError: error !== null,
      ...(error ? { errorFile: error.file } : {}),
      ...component.flags,
    });
  }

  return entries.sort((a, b) => a.id.localeCompare(b.id));
}
