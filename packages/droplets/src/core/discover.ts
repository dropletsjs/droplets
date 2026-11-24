import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { loadDirectoryNames, loadTextFile } from "./fs.ts";
import { langOfFile, readExportedFlags } from "./flags.ts";
import { type LogReportInput, logger } from "./logger.ts";
import {
  COMPONENT_FILES_DUPLICATE,
  COMPONENT_NOT_RECOGNISED,
  COMPONENT_RENDERER_MISSING,
  DROPLET_FOLDERS_MISNAMED,
  ERROR_PAGE_FLAGS_IGNORED,
  ERROR_PAGE_OTHER_FRAMEWORK,
  LOAD_FILE_MISNAMED,
  SCRIPT_ERROR_PAGE_IGNORED,
} from "../errors/config.ts";
import { type AnyMessage, dropletsError } from "../errors/format.ts";
import {
  CORE_SUFFIXES,
  MODULE_EXTENSIONS,
  noRendererHint,
  pickRenderer,
  SCRIPT_RENDERER,
  validateRenderers,
  withFlagDefaults,
  type ComponentKind,
  type DropletRenderer,
  type HydrateMode,
  type RenderFlags,
} from "../renderer.ts";
import { isKebabName } from "../runtime/web-url.ts";

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
  /** `+droplet.ts` or `+droplet.js`; set with `hasLoad`. */
  loadFile?: string;
  hasServerLoad: boolean;
  /** `+droplet.server.ts` or `+droplet.server.js`; set with `hasServerLoad`. */
  serverLoadFile?: string;
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

type FindComponentInput = {
  kind: ComponentKind;
  folderName: string;
  folder: string;
  files: readonly string[];
  byExtension: ReadonlyMap<string, DropletRenderer[]>;
  droplet: string;
  /** The droplet's renderer, when looking for its error page. */
  framework?: DropletRenderer;
};

export type DiscoverDropletsInput = {
  dropletsRoot: string;
  renderers?: DropletRenderer[];
};

/** Folder name -> route id: the name itself when it is lowercase kebab-case (`hello-world`), else `null`. */
export function dropletId({ folderName }: DropletIdInput): string | null {
  return isKebabName({ name: folderName }) ? folderName : null;
}

/** Whether the droplet ships a browser bundle: it hydrates, its error page with it. */
export function shipsClient(entry: Pick<DropletEntry, "hydrate">): boolean {
  return entry.hydrate !== false;
}

/** A load file spelled with an extension core does not load: `+droplet.mts`, `+droplet.server.cjs`. */
const MISNAMED_LOAD = /^\+[Dd]roplet(\.server)?\.[cm][jt]s$/;

/** `+droplet.vue` -> `.vue`; `+Droplet.fake.js` -> `.fake.js`; anything else -> `null`. */
function componentSuffix({ fileName, kind }: ComponentSuffixInput): string | null {
  const prefix = kind === "droplet" ? /^\+[Dd]roplet(\..+)$/ : /^\+[Ee]rror(\..+)$/;
  const match = fileName.match(prefix);
  const suffix = match?.[1];
  if (!suffix || CORE_SUFFIXES.has(suffix) || (kind === "droplet" && MISNAMED_LOAD.test(fileName))) return null;
  return suffix;
}

type LoadFileInput = { files: readonly string[]; name: "+droplet" | "+droplet.server" };

/** The load file of a droplet folder by `MODULE_EXTENSIONS` order; `undefined` without one. */
function loadFile({ files, name }: LoadFileInput): string | undefined {
  return MODULE_EXTENSIONS.map((extension) => `${name}${extension}`).find((file) => files.includes(file));
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

/** What was already reported, so a rescan (or the next environment's build) stays quiet. */
const reported = new Set<string>();

export type ReportOnceInput<M extends AnyMessage> = LogReportInput<M> & { key: string };

/** Reports once per key for the process: a file taken for what it is not, a folder ignored. */
export function reportOnce<M extends AnyMessage>(input: ReportOnceInput<M>): void {
  if (reported.has(input.key)) return;
  reported.add(input.key);
  logger.report(input);
}

/**
 * The one `+droplet.*` (or `+error.*`) file of a folder, with its renderer
 * and flags. Two such files are an error; a suffix no renderer handles is
 * an error too. The error page is the droplet's error boundary: written in
 * the droplet's framework (`framework`), it follows the droplet's flags. An
 * error page in another framework is ignored with a warning, as are the
 * flags it declares, in build and in dev.
 */
async function findComponent({
  kind,
  folderName,
  folder,
  files,
  byExtension,
  droplet,
  framework,
}: FindComponentInput): Promise<Found | null> {
  const handlers = (f: string): DropletRenderer[] => {
    const suffix = componentSuffix({ fileName: f, kind });
    return suffix === null ? [] : (byExtension.get(suffix) ?? []);
  };
  let candidates = files.filter((f) => componentSuffix({ fileName: f, kind }) !== null);
  if (framework) {
    const reportOther = (f: string) =>
      reportOnce({
        key: `${folder}/${f}:framework`,
        message: ERROR_PAGE_OTHER_FRAMEWORK,
        params: { framework: framework.name },
        file: `${folderName}/${f}`,
      });
    for (const f of candidates.filter((f) => !handlers(f).includes(framework))) reportOther(f);
    candidates = candidates.filter((f) => handlers(f).includes(framework));
    const [only] = candidates;
    if (only !== undefined && candidates.length === 1 && handlers(only).length > 1) {
      // A suffix another renderer shares: the error page's imports decide.
      const source = (await loadTextFile({ path: resolve(folder, only) })) ?? "";
      const picked = pickRenderer({ candidates: handlers(only), source, file: `${folderName}/${only}`, fallback: framework });
      if (picked !== framework) {
        reportOther(only);
        return null;
      }
    }
  }
  const [file] = candidates;
  if (file === undefined) return null;
  if (candidates.length > 1) {
    throw dropletsError({
      message: COMPONENT_FILES_DUPLICATE,
      params: { folder: folderName, count: candidates.length, kind, files: candidates.join(", ") },
    });
  }
  const suffix = componentSuffix({ fileName: file, kind });
  if (suffix === null) throw dropletsError({ message: COMPONENT_NOT_RECOGNISED, params: { kind }, file: `${folderName}/${file}` });
  const group = byExtension.get(suffix);
  if (!group) {
    throw dropletsError({
      message: COMPONENT_RENDERER_MISSING,
      params: { extension: suffix, hint: noRendererHint({ extension: suffix }) },
      file: `${folderName}/${file}`,
    });
  }

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
      reportOnce({
        key: `${folder}/${file}:${own.join(",")}`,
        message: ERROR_PAGE_FLAGS_IGNORED,
        params: { flags: own.map((name) => `"${name}"`).join(", ") },
        file: `${folderName}/${file}`,
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
export async function discoverDroplets({ dropletsRoot, renderers = [] }: DiscoverDropletsInput): Promise<DropletEntry[]> {
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
    const component = await findComponent({ kind: "droplet", folderName: name, folder, files, byExtension, droplet: id });
    if (!component) continue;
    for (const f of files.filter((f) => MISNAMED_LOAD.test(f))) {
      const base = f.includes(".server.") ? "+droplet.server" : "+droplet";
      reportOnce({
        key: `${folder}/${f}:misnamed`,
        message: LOAD_FILE_MISNAMED,
        params: { names: MODULE_EXTENSIONS.map((extension) => `${base}${extension}`).join(" or ") },
        file: `${name}/${f}`,
      });
    }

    // One framework per droplet: an error page in another one is ignored.
    // A script droplet has none: it renders nothing, on either side.
    const script = component.renderer.name === SCRIPT_RENDERER;
    if (script) {
      for (const f of files.filter((f) => componentSuffix({ fileName: f, kind: "error" }) !== null)) {
        reportOnce({ key: `${folder}/${f}:script`, message: SCRIPT_ERROR_PAGE_IGNORED, file: `${name}/${f}` });
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
          framework: component.renderer,
        });
    const load = loadFile({ files, name: "+droplet" });
    const serverLoad = loadFile({ files, name: "+droplet.server" });
    entries.push({
      id,
      name,
      file: component.file,
      renderer: component.renderer.name,
      hasLoad: load !== undefined,
      ...(load === undefined ? {} : { loadFile: load }),
      hasServerLoad: serverLoad !== undefined,
      ...(serverLoad === undefined ? {} : { serverLoadFile: serverLoad }),
      hasError: error !== null,
      ...(error ? { errorFile: error.file } : {}),
      ...component.flags,
    });
  }

  if (ignored.length > 0) {
    logger.report({ message: DROPLET_FOLDERS_MISNAMED, params: { folders: ignored.join(", ") } });
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}
