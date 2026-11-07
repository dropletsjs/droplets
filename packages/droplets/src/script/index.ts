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
 * touch `window` at the top level. In the browser it always runs: at once,
 * or with `export const hydrate = "visible"` as the element is about to
 * scroll into view. `hydrate = false`, `"interactive"` (there is no server
 * markup to interact with) and any `ssr` are build errors.
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
import { packageDist } from "../core/paths.ts";
import {
  readExportedFlags,
  SCRIPT_RENDERER,
  SCRIPT_SUFFIXES,
  type DropletRenderer,
  type ReadFlagsInput,
  type RenderFlags,
} from "../renderer.ts";

/**
 * The flags of a script droplet: `hydrate` (`true`, the default, or
 * `"visible"`) and `prerender`. Anything that would keep it from running
 * in the browser, or that it cannot have, is an error naming the fix.
 */
export function readScriptFlags(input: Pick<ReadFlagsInput, "source" | "file" | "droplet">): Partial<RenderFlags> {
  const where = `${input.droplet}/${input.file}`;
  const flags = readExportedFlags(input.source, input.droplet);
  if (flags.ssr !== undefined) {
    throw new Error(
      `droplets: ${where}: a script droplet renders nothing on the server, so it has no ssr flag; remove export const ssr`,
    );
  }
  if (flags.hydrate === false) {
    throw new Error(
      `droplets: ${where}: hydrate = false would never run it; a script droplet only runs in the browser. ` +
        'Remove the line (it runs at once) or use "visible"',
    );
  }
  if (flags.hydrate === "interactive") {
    throw new Error(
      `droplets: ${where}: "interactive" waits for a first interaction with the server markup, and a script droplet has none; ` +
        'use true (the default) or "visible"',
    );
  }
  return flags;
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

/** The user's renderers, with the built-in one for script droplets after them. */
export function withScriptRenderer(renderers: readonly DropletRenderer[]): DropletRenderer[] {
  return [...renderers, scriptRenderer()];
}

/** The renderers the user configured: every one but the built-in. */
export function userRenderers(renderers: readonly DropletRenderer[]): DropletRenderer[] {
  return renderers.filter((renderer) => renderer.name !== SCRIPT_RENDERER);
}

/** Whether a droplet's renderer is the built-in script one. */
export function isScriptDroplet(entry: { renderer: string }): boolean {
  return entry.renderer === SCRIPT_RENDERER;
}
