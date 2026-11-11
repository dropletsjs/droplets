/**
 * The project as the droplets plugin sees it, without serving or building:
 * resolving the Vite config runs the plugin's config hook, which finds the
 * droplets, as `vite dev` would.
 */
import { resolve } from "node:path";
import { resolveConfig } from "vite";
import type { DropletsPluginApi } from "../vite/plugin.ts";

export type ProjectOptions = { root?: string; config?: string; mode?: string };

export type Project = { root: string; configFile: string | undefined; api: DropletsPluginApi };

export async function loadProject({ root: rootOption, config: configOption, mode = "development" }: ProjectOptions): Promise<Project> {
  const root = resolve(rootOption ?? process.cwd());
  const config = await resolveConfig(
    { root, ...(configOption ? { configFile: resolve(root, configOption) } : {}), logLevel: "warn" },
    "serve",
    mode,
  );
  const plugin = config.plugins.find((p) => p.name === "droplets") as { api?: DropletsPluginApi } | undefined;
  if (!plugin?.api) throw new Error("no droplets() plugin in the Vite config");
  return { root, configFile: config.configFile, api: plugin.api };
}
