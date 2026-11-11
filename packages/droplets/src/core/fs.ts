import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
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

/** Writes a UTF-8 file, creating parent directories as needed. */
export async function writeTextFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
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

/** Immediate subdirectory names, or `[]` when the folder is missing. */
export async function listDirectories(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
