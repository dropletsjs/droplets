import { existsSync } from "node:fs";

/** Loads the repository's gitignored `.env.local`, when there is one; variables already set win. */
export function loadEnvLocal(): void {
  const file = new URL("../../.env.local", import.meta.url);
  if (existsSync(file)) process.loadEnvFile(file);
}
