/**
 * Where runtime (non-static) private variables come from. Kept on
 * `globalThis` because the server, the SSR bundle and, in dev, Vite's module
 * runner may each load their own copy of this module.
 */
const STORE = Symbol.for("droplets.env");

type Store = { values?: Record<string, unknown> };

function store(): Store {
  const global = globalThis as { [STORE]?: Store };
  global[STORE] ??= {};
  return global[STORE];
}

/**
 * Sets the source of runtime variables: Workers bindings per request, the
 * dev server's `.env` values. Without it, the process environment is used where it
 * exists.
 */
export function setRuntimeEnv(values: Record<string, unknown> | undefined): void {
  store().values = values;
}

export function readRuntimeEnv(name: string): string | undefined {
  const values = store().values ??
    (typeof process === "undefined" ? undefined : process.env);
  const value = values?.[name];
  return typeof value === "string" ? value : undefined;
}
