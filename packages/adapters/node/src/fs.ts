import { readFile } from "node:fs/promises";

type IsNotFoundInput = { error: unknown };

export type LoadTextFileInput = { path: string };

export type LoadJsonFileInput = { path: string };

type MalformedJsonErrorInput = { path: string; cause: unknown };

// An error thrown for the one failure a caller tells apart from a missing file.
export class MalformedJsonError extends Error {
  readonly path: string;

  constructor({ path, cause }: MalformedJsonErrorInput) {
    super(`${path} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "MalformedJsonError";
    this.path = path;
  }
}

function isNotFound({ error }: IsNotFoundInput): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** A UTF-8 file's text; `null` when it does not exist. */
export async function loadTextFile({ path }: LoadTextFileInput): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound({ error })) return null;
    throw error;
  }
}

/** A JSON file, parsed; `null` when missing, a `MalformedJsonError` when it does not parse. */
export async function loadJsonFile<T>({ path }: LoadJsonFileInput): Promise<T | null> {
  const raw = await loadTextFile({ path });
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (cause) {
    throw new MalformedJsonError({ path, cause });
  }
}
