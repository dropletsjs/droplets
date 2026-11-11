import { readFile } from "node:fs/promises";

type IsNotFoundInput = { error: unknown };

export type LoadTextFileInput = { path: string };

export type LoadJsonFileInput = { path: string };

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

/** A JSON file, parsed; `null` when missing or malformed. */
export async function loadJsonFile<T>({ path }: LoadJsonFileInput): Promise<T | null> {
  const raw = await loadTextFile({ path });
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Malformed reads as missing: the caller falls back to its default.
    return null;
  }
}
