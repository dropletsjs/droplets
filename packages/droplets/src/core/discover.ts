import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileExists, loadDirectoryNames, loadTextFile } from "./fs.ts";
import { langOfFile, readExportedFlags } from "./flags.ts";
import { logger } from "./logger.ts";
import {
  CORE_SUFFIXES,
  noRendererMessage,
  pickRenderer,
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
  /** Route id: the folder name. */
  id: string;
  /** Folder name on disk, the same as the id. */
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

export type DropletIdInput = { folderName: string };

type ComponentSuffixInput = { fileName: string; kind: ComponentKind };

type LoadFileNamesInput = { dir: string };

type ReportInput = { dev: boolean | undefined; key: string; message: string };

type FindComponentInput = {
  kind: ComponentKind;
  folderName: string;
  folder: string;
  files: readonly string[];
  byExtension: ReadonlyMap<string, DropletRenderer[]>;
  droplet: string;
  dev: boolean | undefined;
  /** The droplet's renderer, when looking for its error page. */
  framework?: DropletRenderer;
};

export type DiscoverDropletsInput = {
  dropletsRoot: string;
  renderers?: DropletRenderer[];
  /** The dev server: flags an error page declares are reported, once each. */
  dev?: boolean;
};

/** A droplet folder's name, which is its id: lowercase kebab-case. */
const DROPLET_FOLDER = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Folder name -> route id: the name itself when it is lowercase kebab-case (`hello-world`), else `null`. */
export function dropletId({ folderName }: DropletIdInput): string | null {
  return DROPLET_FOLDER.test(folderName) ? folderName : null;
}

/** Whether the droplet ships a browser bundle: it hydrates, its error page with it. */
export function shipsClient(entry: Pick<DropletEntry, "hydrate">): boolean {
  return entry.hydrate !== false;
}

/** `+droplet.vue` -> `.vue`; `+Droplet.fake.js` -> `.fake.js`; anything else -> `null`. */
function componentSuffix({ fileName, kind }: ComponentSuffixInput): string | null {
  const prefix = kind === "droplet" ? /^\+[Dd]roplet(\..+)$/ : /^\+[Ee]rror(\..+)$/;
  const match = fileName.match(prefix);
  const suffix = match?.[1];
  if (!suffix || CORE_SUFFIXES.has(suffix)) return null;
  return suffix;
}

async function loadFileNames({ dir }: LoadFileNamesInput): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  } catch {
    // A folder that cannot be read holds no component.
    return [];
  }
}

type Found = { file: string; renderer: DropletRenderer; flags: RenderFlags };

/** Error pages and misnamed folders already reported, so a rescan (or the next environment's build) stays quiet. */
const reported = new Set<string>();

/** In dev, says why an error page is not taken as it is, once per file and reason. */
function report({ dev, key, message }: ReportInput): void {
  if (!dev || reported.has(key)) return;
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
async function findComponent({
  kind,
  folderName,
  folder,
  files,
  byExtension,
  droplet,
  dev,
  framework,
}: FindComponentInput): Promise<Found | null> {
  const handlers = (f: string): DropletRenderer[] => {
    const suffix = componentSuffix({ fileName: f, kind });
    return suffix === null ? [] : (byExtension.get(suffix) ?? []);
  };
  let candidates = files.filter((f) => componentSuffix({ fileName: f, kind }) !== null);
  if (framework) {
    const other = (f: string) =>
      `${folderName}/${f} is not a ${framework.name} component like the droplet; ignored, ` +
      "the error page is written in the droplet's framework";
    for (const f of candidates.filter((f) => !handlers(f).includes(framework))) {
      report({ dev, key: `${folder}/${f}:framework`, message: other(f) });
    }
    candidates = candidates.filter((f) => handlers(f).includes(framework));
    const [only] = candidates;
    if (only !== undefined && candidates.length === 1 && handlers(only).length > 1) {
      // A suffix another renderer shares: the error page's imports decide.
      const source = (await loadTextFile({ path: resolve(folder, only) })) ?? "";
      const picked = pickRenderer({ candidates: handlers(only), source, file: `${folderName}/${only}`, fallback: framework });
      if (picked !== framework) {
        report({ dev, key: `${folder}/${only}:framework`, message: other(only) });
        return null;
      }
    }
  }
  const [file] = candidates;
  if (file === undefined) return null;
  if (candidates.length > 1) {
    throw new Error(`droplets: ${folderName}/ has ${candidates.length} ${kind} components (${candidates.join(", ")}); keep one`);
  }
  const suffix = componentSuffix({ fileName: file, kind });
  if (suffix === null) throw new Error(`droplets: ${folderName}/${file} is not a ${kind} component`);
  const group = byExtension.get(suffix);
  if (!group) throw new Error(`droplets: ${noRendererMessage({ file: `${folderName}/${file}`, extension: suffix })}`);

  const source = (await loadTextFile({ path: resolve(folder, file) })) ?? "";
  const renderer = pickRenderer({ candidates: group, source, file: `${folderName}/${file}`, fallback: framework });
  const where = kind === "droplet" ? droplet : `${droplet}/${file}`;
  const declared = renderer.readFlags
    ? await renderer.readFlags({
        kind,
        source,
        file,
        folder,
        droplet,
      })
    : readExportedFlags(source, where, langOfFile({ file }));
  if (kind === "error") {
    const own = Object.keys(declared ?? {});
    if (own.length > 0) {
      report({
        dev,
        key: `${folder}/${file}:${own.join(",")}`,
        message:
          `${folderName}/${file} declares ${own.map((name) => `"${name}"`).join(", ")}; ignored, ` +
          "+error.* follows the droplet's ssr, hydrate and prerender",
      });
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
export async function discoverDroplets({ dropletsRoot, renderers = [], dev }: DiscoverDropletsInput): Promise<DropletEntry[]> {
  const byExtension = validateRenderers(renderers);
  const entries: DropletEntry[] = [];
  const ignored: string[] = [];

  for (const name of await loadDirectoryNames({ path: dropletsRoot })) {
    const folder = resolve(dropletsRoot, name);
    const files = await loadFileNames({ dir: folder });
    const id = dropletId({ folderName: name });
    if (id === null) {
      const isDroplet = files.some((f) => componentSuffix({ fileName: f, kind: "droplet" }) !== null);
      if (isDroplet && !reported.has(`${folder}:name`)) {
        reported.add(`${folder}:name`);
        ignored.push(name);
      }
      continue;
    }
    const component = await findComponent({ kind: "droplet", folderName: name, folder, files, byExtension, droplet: id, dev });
    if (!component) continue;

    // One framework per droplet: an error page in another one is ignored.
    // A script droplet has none: it renders nothing, on either side.
    const script = component.renderer.name === SCRIPT_RENDERER;
    if (script) {
      for (const f of files.filter((f) => componentSuffix({ fileName: f, kind: "error" }) !== null)) {
        report({ dev, key: `${folder}/${f}:script`, message: `${name}/${f} is ignored: a script droplet has no error page` });
      }
    }
    const error = script
      ? null
      : await findComponent({
          kind: "error",
          folderName: name,
          folder,
          files,
          byExtension,
          droplet: id,
          dev,
          framework: component.renderer,
        });
    entries.push({
      id,
      name,
      file: component.file,
      renderer: component.renderer.name,
      hasLoad: await fileExists({ path: resolve(folder, "+droplet.ts") }),
      hasServerLoad: await fileExists({ path: resolve(folder, "+droplet.server.ts") }),
      hasError: error !== null,
      ...(error ? { errorFile: error.file } : {}),
      ...component.flags,
    });
  }

  if (ignored.length > 0) {
    logger.warn(
      "framework",
      `These droplet folders do not match the naming convention (lowercase kebab-case) and are ignored: ${ignored.join(", ")}`,
    );
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}
