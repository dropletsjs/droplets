import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { compareRoutes, type RouteSegment } from "../runtime/routes.ts";

/** A `+server.ts` found on disk, before its module is loaded. */
export type ApiRouteEntry = {
  /** The route as written on disk, e.g. `/api/users/[id]`. */
  id: string;
  /** Path of the file relative to the API folder, with `/` separators. */
  file: string;
  segments: RouteSegment[];
};

const SERVER_FILES = ["+server.ts", "+server.js"];

/** URL prefix every API route lives under. */
export const API_PREFIX = "/api";

export type ParseSegmentInput = { folder: string; file: string };

export type RouteFromFoldersInput = { folders: readonly string[]; file: string };

type WalkInput = { dir: string; found: string[] };

export type DiscoverApiRoutesInput = { apiRoot: string };

/**
 * Turns one folder name into a route segment, SvelteKit style. `(group)`
 * folders organise files without adding to the URL and return `null`.
 */
export function parseSegment({ folder, file }: ParseSegmentInput): RouteSegment | null {
  if (/^\(.+\)$/.test(folder)) return null;

  const rest = folder.match(/^\[\.\.\.([A-Za-z_$][\w$]*)\]$/);
  if (rest?.[1]) return { type: "rest", name: rest[1] };

  const param = folder.match(/^\[([A-Za-z_$][\w$]*)\]$/);
  if (param?.[1]) return { type: "param", name: param[1] };

  if (/[[\]]/.test(folder)) {
    throw new Error(
      `droplets: unsupported route segment "${folder}" in ${file}; use [name] or [...name] (matchers and optional parameters are not supported yet)`,
    );
  }
  return { type: "static", value: folder };
}

/** Folder path, relative to the API folder, -> route segments. */
export function routeFromFolders({ folders, file }: RouteFromFoldersInput): ApiRouteEntry {
  const segments: RouteSegment[] = [];
  const names = new Set<string>();
  for (const folder of folders) {
    const segment = parseSegment({ folder, file });
    if (!segment) continue;
    if (segment.type !== "static") {
      if (names.has(segment.name)) {
        throw new Error(`droplets: parameter "${segment.name}" appears twice in ${file}`);
      }
      names.add(segment.name);
    }
    if (segments.at(-1)?.type === "rest") {
      throw new Error(`droplets: a [...rest] segment must be the last one, in ${file}`);
    }
    segments.push(segment);
  }

  const id = [API_PREFIX, ...folders.filter((f) => !/^\(.+\)$/.test(f))].join("/");
  return { id, file, segments: [{ type: "static", value: API_PREFIX.slice(1) }, ...segments] };
}

async function walk({ dir, found }: WalkInput): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // No API folder, or one that cannot be read: no routes from it.
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk({ dir: full, found });
    else if (SERVER_FILES.includes(entry.name)) found.push(full);
  }
}

/**
 * Every `+server.ts` under `apiRoot`, as routes sorted most specific first.
 * Two files that map to the same URL are an error.
 */
export async function discoverApiRoutes({ apiRoot }: DiscoverApiRoutesInput): Promise<ApiRouteEntry[]> {
  const files: string[] = [];
  await walk({ dir: apiRoot, found: files });

  const routes: ApiRouteEntry[] = [];
  const byShape = new Map<string, string>();
  for (const full of files) {
    const file = relative(apiRoot, full).split(sep).join("/");
    const folders = file.split("/").slice(0, -1);
    const route = routeFromFolders({ folders, file });

    // `[id]` and `[slug]` at the same place match the same URLs.
    const shape = route.segments.map((s) => (s.type === "static" ? s.value : s.type === "param" ? "[]" : "[...]")).join("/");
    const clash = byShape.get(shape);
    if (clash) {
      throw new Error(`droplets: ${clash} and ${file} both answer ${route.id}`);
    }
    byShape.set(shape, file);
    routes.push(route);
  }

  return routes.sort((a, b) => compareRoutes(a, b) || a.id.localeCompare(b.id));
}
