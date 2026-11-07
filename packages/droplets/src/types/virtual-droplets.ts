/**
 * Type stub for the `virtual:droplets` module.
 *
 * The real module is generated per environment by the Vite plugin: the
 * server build gets the component registry, the API routes and the hooks,
 * the client build gets only the id/hydration maps. This file exists so
 * editors and `tsc` can resolve the import (wired through `paths` in
 * tsconfig.json).
 */
import type { ApiRoute } from "../runtime/routes.ts";

export type DropletLoadModule = {
  load?: (event: never) => unknown;
  handleError?: unknown;
};

export type DropletLoadModuleLoader = () => Promise<DropletLoadModule>;

export type DropletRegistryEntry = {
  /** The component module namespace. */
  component?: unknown;
  /** The server side of its renderer. */
  renderer?: unknown;
  ssr?: boolean;
  hydrate?: boolean | "visible" | "interactive";
  load?: DropletLoadModuleLoader;
  serverLoad?: DropletLoadModuleLoader;
  /** The error page module of this droplet, in the droplet's framework. */
  error?: unknown;
};

/** Server build: id -> component + load hooks. Empty in the stub. */
const droplets: Record<string, DropletRegistryEntry> = {};
export default droplets;

/** Server build: `+server.ts` routes, most specific first. */
export const api: ApiRoute[] = [];
/** Server build: the exports of `src/hooks.server.ts`, or `{}`. */
export const hooks: Record<string, unknown> = {};
/** Server build: the exports of `src/importmap.server.ts`, or `{}`. */
export const importMapModule: Record<string, unknown> = {};
/** Server build: public variables read at runtime (`public: true`, not `static`). */
export const publicEnvNames: string[] = [];

/** Client build: build identity + which droplets exist / hydrate. */
export const buildHash = "";
export const elementName = "djs-droplet";
/** Client build: `dev.strategy` of the config; read only under `vite dev`. */
export const devStrategy = "remount" as "remount" | "reload" | "manual";
/** Client build: `dev.injectTool` of the config; read only under `vite dev`. */
export const devInjectTool = false as boolean;
/** Client build: the dev tool's module under `vite dev` when `dropletsDevtools()` is installed, else `null`. */
export const devToolUrl = null as string | null;
export const dropletsById: Record<string, boolean> = {};
/** Client build: the droplets that hydrate, and when (`true`, `"visible"`, `"interactive"`). */
export const dropletsHydrateById: Record<string, true | "visible" | "interactive"> = {};
/** Client build: droplets with `+droplet.server.ts`, the only ones with `_data`. */
export const dropletsServerLoadById: Record<string, boolean> = {};
/**
 * Client build: every stylesheet of each droplet that has any, relative to
 * the server (`assets/…`), its shared chunks' first. Empty under `vite dev`.
 */
export const dropletsStylesById: Record<string, string[]> = {};
