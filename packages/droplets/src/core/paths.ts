import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function findPackageRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate the droplets package root from ${start}`);
    }
    dir = parent;
  }
}

/** Root of the installed `@dropletsjs/droplets` package. */
export const packageRoot = findPackageRoot(
  dirname(fileURLToPath(import.meta.url)),
);

/**
 * The compiled package. Three of these files are not run by Node directly:
 * the consuming project's Vite instance compiles them into its own bundles.
 */
export const packageDist = resolve(packageRoot, "dist");

/** Browser entry: defines `<djs-droplet>`. Built into the client bundle. */
export const entryClientPath = resolve(packageDist, "runtime/entry-client.js");
/** SSR entry: the component registry and the load chain. */
export const entryServerPath = resolve(packageDist, "runtime/entry-server.js");
/** `$droplets/server`: events, `handle`, `json()`, `error()`, `redirect()`. */
export const serverModulePath = resolve(packageDist, "runtime/server.js");
/** Props validation, imported by every droplet's browser entry. */
export const propsModulePath = resolve(packageDist, "runtime/props.js");
/** The load and `handleError` contracts, imported by every droplet's browser entry. */
export const loadModulePath = resolve(packageDist, "runtime/load.js");
/** Where `$droplets/env/private` reads runtime variables from. */
export const envStorePath = resolve(packageDist, "runtime/env-store.js");
/** Where `$droplets/drop` reads the current request on the server. */
export const requestStorePath = resolve(packageDist, "runtime/request-store.js");
/** Action URLs: imported by every droplet's browser entry and by `$droplets/form`. */
export const formModulePath = resolve(packageDist, "runtime/form.js");
/** `enhanceDropletForm`: what `$droplets/form` re-exports, and `@dropletsjs/droplets/enhance` is. */
export const enhanceModulePath = resolve(packageDist, "runtime/enhance.js");

/** Runs `init` of `src/hooks.client.ts`: imported by the browser registry only when the file exists. */
export const clientInitModulePath = resolve(packageDist, "runtime/client-init.js");

/** Turns an absolute path into a URL Vite can transform. */
export function toViteFsPath(filePath: string): string {
  return `/@fs/${filePath.replace(/\\/g, "/")}`;
}
