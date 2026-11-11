/**
 * Script droplets: a droplet whose component is plain browser code. A
 * `+droplet.script.ts` (or `.js`) default-exports a function that runs in
 * the browser with the droplet's `data` (what its loads returned, as for
 * any droplet) and its element, and may return a cleanup:
 *
 * ```ts
 * // src/droplets/page-views/+droplet.script.ts
 * import type { DropletScript } from "./$types";
 *
 * const track: DropletScript = (data, el) => {
 *   const controller = new AbortController();
 *   void fetch("/api/page-views", { method: "POST", signal: controller.signal });
 *   el.textContent = `${data.views} views`;
 *   return () => controller.abort();
 * };
 * export default track;
 * ```
 *
 * The server renders nothing for it (the fragment is the element, its data
 * payload and an empty content root) and never imports the file: it may
 * touch `window` at the top level. It is client only and runs at once in
 * the browser: `ssr` false, `hydrate` true, never prerendered, whatever the
 * file exports. An exported flag warns once per file and is ignored.
 *
 * The renderer is built in: core adds it to every renderer list, so no
 * package is needed. It is plain JavaScript; no Vite plugin, no framework.
 * A script droplet may import any package, whatever the other droplets of
 * the project are written in: the cross-framework check leaves it alone.
 * Server files stay out of its bundle like out of any other.
 *
 * @module
 */
import { resolve } from "node:path";
import { langOfFile, readExportedFlags } from "../core/flags.ts";
import { logger } from "../core/logger.ts";
import { packageDist } from "../core/paths.ts";
import { SCRIPT_RENDERER, SCRIPT_SUFFIXES, type DropletRenderer, type ReadFlagsInput, type RenderFlags } from "../renderer.ts";

type ReadScriptFlagsInput = Pick<ReadFlagsInput, "source" | "file" | "droplet">;

const CLIENT_ONLY: RenderFlags = { ssr: false, hydrate: true, prerender: false };

/** Discovery reads a file again on every rescan and in every environment. */
const reported = new Set<string>();

/**
 * The flags of a script droplet, always client only. A flag the file
 * exports never fails the build: it warns once and is ignored.
 */
export function readScriptFlags({ source, file, droplet }: ReadScriptFlagsInput): RenderFlags {
  const where = `${droplet}/${file}`;
  for (const [name, value] of Object.entries(readExportedFlags(source, droplet, langOfFile({ file })))) {
    const key = `${where}:${name}`;
    if (reported.has(key)) continue;
    reported.add(key);
    logger.warn(
      "framework",
      name === "hydrate" && value === true
        ? `${where} exports hydrate = true; a script droplet is always hydrated (locked to true)`
        : `${where} exports ${name} = ${JSON.stringify(value)}; this is ignored, a script droplet is client only`,
    );
  }
  return { ...CLIENT_ONLY };
}

/** The built-in renderer of `+droplet.script.ts` and `+droplet.script.js`. */
export function scriptRenderer(): DropletRenderer {
  return {
    name: SCRIPT_RENDERER,
    extensions: [...SCRIPT_SUFFIXES],
    server: resolve(packageDist, "script/server.js"),
    client: resolve(packageDist, "script/client.js"),
    readFlags: (input) => readScriptFlags(input),
  };
}

type WithScriptRendererInput = { renderers: readonly DropletRenderer[] };

/** The user's renderers, with the built-in one for script droplets after them. */
export function withScriptRenderer({ renderers }: WithScriptRendererInput): DropletRenderer[] {
  return [...renderers, scriptRenderer()];
}

type UserRenderersInput = { renderers: readonly DropletRenderer[] };

/** The renderers the user configured: every one but the built-in. */
export function userRenderers({ renderers }: UserRenderersInput): DropletRenderer[] {
  return renderers.filter((renderer) => renderer.name !== SCRIPT_RENDERER);
}

type IsScriptDropletInput = { renderer: string };

/** Whether a droplet's renderer is the built-in script one. */
export function isScriptDroplet({ renderer }: IsScriptDropletInput): boolean {
  return renderer === SCRIPT_RENDERER;
}
