import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type IsMainModuleInput = {
  /** The module's own `import.meta.url`. */
  moduleUrl: string;
  /** `process.argv[1]`: the file Node was given, as given. */
  argv1: string | undefined;
};

type RealPathInput = { path: string };

function realPath({ path }: RealPathInput): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/**
 * Whether `node <argv1>` runs this module. `argv[1]` stays as typed while
 * Node adds the extension it tried (`node dist/server`) and follows a
 * symlink before it runs the file, so both sides compare as real paths.
 */
export function isMainModule({ moduleUrl, argv1 }: IsMainModuleInput): boolean {
  if (!argv1) return false;
  const own = realPath({ path: fileURLToPath(moduleUrl) });
  if (own === null) return false;
  const given = resolve(argv1);
  return [given, `${given}.js`, `${given}.mjs`].some((candidate) => realPath({ path: candidate }) === own);
}
