/**
 * Which of a host's recorded files are in public/hosts/ (written by
 * `pnpm test:hosts <host> --docs`), so a host that has not been recorded yet
 * shows a note instead of broken media. Checked when the page is built;
 * Astro builds from the docs folder, so public/ is under the working directory.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

const hosts = join(process.cwd(), "public", "hosts");

/** Whether `public/hosts/<path>` exists. */
export const hasHostFile = (path: string): boolean => existsSync(join(hosts, path));
