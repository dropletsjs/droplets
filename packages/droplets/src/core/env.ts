import { resolve } from "node:path";
import { loadEnv, runnerImport } from "vite";
import { validateEnvDeclaration, type EnvDeclaration } from "../env.ts";
import { fileExists } from "./fs.ts";

/** Where the declaration lives, like SvelteKit's `src/env.ts`. */
export const ENV_FILES = ["src/env.ts", "src/env.js"];

export type EnvState = {
  /** Absolute path of `src/env.ts`, or `null` when the project has none. */
  path: string | null;
  declaration: EnvDeclaration;
  /** Every variable Vite sees: `.env` files plus `process.env`. */
  values: Record<string, string>;
  /** `src/env.ts` and what it imports; a change needs a dev restart. */
  dependencies: string[];
};

export async function findEnvFile(root: string): Promise<string | null> {
  for (const file of ENV_FILES) {
    const path = resolve(root, file);
    if (await fileExists(path)) return path;
  }
  return null;
}

/** Reads `src/env.ts` and the values for `mode`. */
export async function loadEnvState(root: string, mode: string, envDir = root): Promise<EnvState> {
  // Every variable, not only VITE_*: the declaration decides what is exposed.
  // Vite itself restarts the dev server when a .env file changes.
  const values = loadEnv(mode, envDir, "");
  const path = await findEnvFile(root);
  if (!path) return { path: null, declaration: {}, values, dependencies: [] };

  const { module, dependencies } = await runnerImport<{ variables?: unknown }>(path, {
    root,
    configFile: false,
    logLevel: "error",
  });
  const declaration = module.variables;
  if (typeof declaration !== "object" || declaration === null) {
    throw new Error(
      `droplets: ${path} must export \`variables\`, e.g. export const variables = defineEnvVars({ ... })`,
    );
  }
  validateEnvDeclaration(declaration as EnvDeclaration);
  return {
    path,
    declaration: declaration as EnvDeclaration,
    values,
    dependencies: [path, ...dependencies.map((dep) => resolve(root, dep))],
  };
}

/** Static variables (public or private) that have no value. */
export function missingStatic(state: EnvState): string[] {
  return Object.entries(state.declaration)
    .filter(([name, options]) => options.static && state.values[name] === undefined)
    .map(([name]) => name);
}

/** Public variables read at runtime: `public: true` without `static`. */
export function dynamicPublicNames(state: EnvState): string[] {
  return Object.entries(state.declaration)
    .filter(([, options]) => options.public && !options.static)
    .map(([name]) => name);
}

/**
 * `$droplets/env/public`: static variables inlined, the rest read at
 * runtime. On the server they come from the environment, like private
 * ones; in the browser from what `/index.js` handed this server's record
 * (see `runtime/servers.ts`), so `serverKey` names the record.
 */
export function buildPublicEnvCode(
  state: EnvState,
  target: { browser: true; serverKey: string } | { browser: false; envStorePath: string },
): string {
  const members = Object.entries(state.declaration)
    .filter(([, options]) => options.public)
    .map(([name, options]) =>
      options.static
        ? `  ${JSON.stringify(name)}: ${JSON.stringify(state.values[name])},`
        : target.browser
        ? `  get ${JSON.stringify(name)}() { return runtime()?.[${JSON.stringify(name)}]; },`
        : `  get ${JSON.stringify(name)}() { return readRuntimeEnv(${JSON.stringify(name)}); },`
    );
  const source = target.browser
    ? `const runtime = () => globalThis[Symbol.for("droplets.servers")]?.[${JSON.stringify(target.serverKey)}]?.env;`
    : `import { readRuntimeEnv } from ${JSON.stringify(target.envStorePath)};`;
  return [source, "export const env = Object.freeze({", ...members, "});", ""].join("\n");
}

/**
 * `$droplets/env/private`: static ones inlined, the rest read at runtime.
 * Never generated for the browser.
 */
export function buildPrivateEnvCode(state: EnvState, envStorePath: string): string {
  const members = Object.entries(state.declaration)
    .filter(([, options]) => !options.public)
    .map(([name, options]) =>
      options.static
        ? `  ${JSON.stringify(name)}: ${JSON.stringify(state.values[name])},`
        : `  get ${JSON.stringify(name)}() { return readRuntimeEnv(${JSON.stringify(name)}); },`
    );
  return [
    `import { readRuntimeEnv } from ${JSON.stringify(envStorePath)};`,
    "export const env = Object.freeze({",
    ...members,
    "});",
    "",
  ].join("\n");
}
