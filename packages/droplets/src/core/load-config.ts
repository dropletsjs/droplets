import { resolve } from "node:path";
import { loadConfigFromFile } from "vite";
import type { ConfigEnv } from "vite";
import { resolveConfig, resolveDevConfig } from "./config.ts";
import type { DropletsConfig, ResolvedDevConfig, ResolvedDropletsConfig } from "./config.ts";
import { ensureTypesTsconfig } from "../vite/sync-types.ts";
import { fileExists } from "./fs.ts";

/** Looked up in this order when no `configFile` is given. */
export const CONFIG_FILE_CANDIDATES = [
  "droplets.config.ts",
  "droplets.config.mts",
  "droplets.config.js",
  "droplets.config.mjs",
] as const;

export type LoadedDropletsConfig = {
  config: ResolvedDropletsConfig;
  dev: ResolvedDevConfig;
  /** Absolute path of the file that was loaded, or `null` for defaults. */
  path: string | null;
  /** Files the config imports, so the dev server can restart on change. */
  dependencies: string[];
};

export async function findConfigFile(
  root: string,
  configFile?: string,
): Promise<string | null> {
  if (configFile) {
    const path = resolve(root, configFile);
    if (!(await fileExists(path))) {
      throw new Error(`droplets: config file not found at ${path}`);
    }
    return path;
  }
  for (const candidate of CONFIG_FILE_CANDIDATES) {
    const path = resolve(root, candidate);
    if (await fileExists(path)) return path;
  }
  return null;
}

/**
 * Loads `droplets.config.ts` the same way Vite loads its own config file, so
 * TypeScript and ESM imports work without any extra tooling.
 */
export async function loadDropletsConfig(
  root: string,
  configEnv: ConfigEnv,
  configFile?: string,
): Promise<LoadedDropletsConfig> {
  await ensureTypesTsconfig(root);
  const path = await findConfigFile(root, configFile);
  let user: DropletsConfig = {};
  let dependencies: string[] = [];

  if (path) {
    const loaded = await loadConfigFromFile(configEnv, path, root);
    if (loaded) {
      user = (loaded.config ?? {}) as DropletsConfig;
      dependencies = loaded.dependencies.map((dep) => resolve(root, dep));
    }
  }

  const env = { port: process.env["PORT"] };
  return { config: resolveConfig(user, env), dev: resolveDevConfig(user, env), path, dependencies };
}
