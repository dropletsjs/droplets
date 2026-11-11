/**
 * Type stub for the `virtual:droplets-dev` module: what `index.js` reads
 * under `vite dev` only, from the dev module (`runtime/dev-element.ts`).
 */
import type { DevStrategy } from "../core/config.ts";

/** `dev.strategy` of the config. */
export const strategy = "hmr" as DevStrategy;
/** `dev.injectTool` of the config. */
export const injectTool = false as boolean;
/** The dev tool's module when `dropletsDevtools()` is installed, else `null`. */
export const toolUrl = null as string | null;
