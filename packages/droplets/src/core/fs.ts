import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type IsNotFoundInput = { error: unknown };

export type FileExistsInput = { path: string };

export type LoadTextFileInput = { path: string };

export type WriteTextFileInput = { path: string; contents: string };

export type LoadJsonFileInput = { path: string };

export type LoadDirectoryNamesInput = { path: string };

function isNotFound({ error }: IsNotFoundInput): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export async function fileExists({ path }: FileExistsInput): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    // Missing or unreadable: either way there is no file to use.
    return false;
  }
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

/** Writes a UTF-8 file, creating parent directories as needed. */
export async function writeTextFile({ path, contents }: WriteTextFileInput): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
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

/** Immediate subdirectory names, or `[]` when the folder is missing. */
export async function loadDirectoryNames({ path }: LoadDirectoryNamesInput): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    // Missing or unreadable: no folders to look into.
    return [];
  }
}
