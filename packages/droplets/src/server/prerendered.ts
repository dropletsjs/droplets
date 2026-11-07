import type { PrerenderedDroplet } from "../runtime/app.ts";

/**
 * Where `vite build` stores prerendered droplets. They are server-only (the
 * build's token nonce, the index of every prop set), so never in a public
 * directory as such:
 *
 * - an adapter that ships `dist/server` (`separateSsrBundle`, Node, Bun,
 *   Deno) finds them in `dist/server/_prerendered/`;
 * - one that ships no server directory (a Worker, which reads them through
 *   its assets) finds them in `dist/client/_prerendered/<random>/`, a name
 *   new every build and kept only in the manifest it inlines
 *   (`__prerendered`), never at a path one could guess.
 */
export const PRERENDER_DIR = "_prerendered";

/** `<droplet>/index.json`: `propsKey` -> file, both relative to the renders' directory. */
export type PrerenderIndex = Record<string, string>;

/** The index file of one droplet, relative to the renders' directory. */
export function prerenderIndexPath(droplet: string): string {
  return `${droplet}/index.json`;
}

/** A droplet name is one path segment: anything else reads no file. */
function isDropletName(droplet: string): boolean {
  return droplet !== "" && droplet !== "." && droplet !== ".." && !/[/\\\0]/.test(droplet);
}

/**
 * Looks up build-time renders: `{ html, data }`, or `{ html, failed, error }`
 * for a load that failed and rendered `+error.*`, through `read`, which
 * returns a file of the renders' directory (see `PRERENDER_DIR`) as text, or
 * `null`: the disk on Node, the assets binding on Workers. Each droplet's
 * index is read once; the renders themselves on demand, so a large site
 * does not sit in memory or in the Worker bundle.
 */
export function createPrerenderedLoader(read: (path: string) => Promise<string | null>) {
  const indexes = new Map<string, Promise<PrerenderIndex | null>>();

  const parse = <T>(text: string | null): T | null => {
    if (text === null) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  };

  return async (droplet: string, key: string): Promise<PrerenderedDroplet | null> => {
    if (!isDropletName(droplet)) return null;
    let index = indexes.get(droplet);
    if (!index) {
      index = read(prerenderIndexPath(droplet)).then((text) => parse<PrerenderIndex>(text));
      indexes.set(droplet, index);
    }
    const found = await index;
    const file = found && typeof found === "object" && !Array.isArray(found) && Object.hasOwn(found, key)
      ? found[key]
      : undefined;
    if (typeof file !== "string" || !file) return null;
    const render = parse<PrerenderedDroplet>(await read(file));
    return render && typeof render === "object" && typeof render.html === "string" ? render : null;
  };
}
