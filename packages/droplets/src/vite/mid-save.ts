import { stat } from "node:fs/promises";
import type { Plugin } from "vite";

/** How long an emptied file may stay empty before the edit counts as an empty file. */
export const MID_SAVE_WINDOW = 1_000;
const POLL = 10;

type UntilWrittenInput = { file: string; within?: number };

/**
 * Resolves once `file` is no longer an empty file whose save may still be
 * under way: at once when it has content, else when its size or mtime
 * changes, or after `within` ms.
 */
export async function untilWritten({ file, within = MID_SAVE_WINDOW }: UntilWrittenInput): Promise<void> {
  const first = await stat(file).catch(() => null);
  if (!first || first.size > 0) return;
  const deadline = Date.now() + within;
  while (Date.now() < deadline) {
    await new Promise((wake) => setTimeout(wake, POLL));
    const now = await stat(file).catch(() => null);
    if (!now || now.size > 0 || now.mtimeMs !== first.mtimeMs) return;
  }
}

/**
 * Under `vite dev`, holds an edit that left its file empty until the save
 * writes the content, before any plugin's hot update reads it. Vite's
 * `read()` waits only about 100 ms; plugin-vue takes an empty file it reads
 * for the new version, and the next write then reloads the component and
 * loses its state.
 */
export function midSavePlugin(): Plugin {
  return {
    name: "droplets:mid-save",
    apply: "serve",
    hotUpdate: {
      order: "pre",
      async handler({ file, type }) {
        // Vite runs the client environment's hooks first: the others find the save done.
        if (type !== "update" || this.environment.name !== "client") return;
        await untilWritten({ file });
      },
    },
  };
}
