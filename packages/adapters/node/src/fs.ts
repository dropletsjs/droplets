import { readFile } from "node:fs/promises";

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}

/** Reads a UTF-8 file, returning `null` when it does not exist. */
export async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Parses a JSON file; `null` when missing or malformed. */
export async function readJsonFile<T>(path: string): Promise<T | null> {
  const raw = await readTextFile(path);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
