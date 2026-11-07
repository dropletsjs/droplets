/**
 * The first `.tsx` framework a project adds needs JSX in `tsconfig.json`:
 * `"jsx": "react-jsx"` with that framework's `jsxImportSource`, and `.tsx`
 * files in `include`. The components `djs add` writes name their import
 * source in a comment, so later JSX frameworks need nothing more. A config
 * that sets `jsx` already (itself or through a relative `extends`) is left
 * alone; the edits are text insertions, so comments stay.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** JSON with comments and trailing commas, as tsconfig allows, to plain JSON. */
export function stripJsonc(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      out += text.slice(i, end + 1);
      i = end;
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
    } else {
      out += char;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

type TsConfig = { extends?: string | string[]; include?: string[]; compilerOptions?: { jsx?: string } };

async function readTsConfig(file: string): Promise<TsConfig | undefined> {
  const text = await readFile(file, "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(stripJsonc(text)) as TsConfig;
  } catch {
    return undefined;
  }
}

/** Whether `file` or a config it extends by a relative path sets `jsx`. */
async function setsJsx(file: string, seen = new Set<string>()): Promise<boolean> {
  if (seen.has(file)) return false;
  seen.add(file);
  const config = await readTsConfig(file);
  if (!config) return false;
  if (config.compilerOptions?.jsx) return true;
  const parents = typeof config.extends === "string" ? [config.extends] : (config.extends ?? []);
  for (const parent of parents.filter((path) => path.startsWith("."))) {
    const path = resolve(dirname(file), parent.endsWith(".json") ? parent : `${parent}.json`);
    if (await setsJsx(path, seen)) return true;
  }
  return false;
}

/** A pattern that takes `.tsx` files: `src`, `src/**\/*`, `**\/*.tsx`. */
const coversTsx = (pattern: string) => pattern.endsWith(".tsx") || pattern.endsWith("*") || !/\.[^/]*$/.test(pattern);

/**
 * `tsconfig.json`'s text with JSX turned on for `importSource`, or
 * `undefined` when it needs nothing (or is not one this can edit).
 */
export async function withJsx(file: string, importSource: string): Promise<string | undefined> {
  const text = await readFile(file, "utf8").catch(() => undefined);
  const config = await readTsConfig(file);
  if (text === undefined || !config) return undefined;
  let code = text;
  if (config.include && !config.include.some(coversTsx)) {
    const include = /"include"\s*:\s*\[/.exec(code);
    if (include) {
      const at = include.index + include[0].length;
      code = `${code.slice(0, at)}"src/**/*.tsx", ${code.slice(at)}`;
    }
  }
  if (!(await setsJsx(file))) {
    const options = `"jsx": "react-jsx", "jsxImportSource": "${importSource}"`;
    const compilerOptions = /"compilerOptions"\s*:\s*\{/.exec(code);
    if (compilerOptions) {
      const at = compilerOptions.index + compilerOptions[0].length;
      const empty = config.compilerOptions !== undefined && Object.keys(config.compilerOptions).length === 0;
      code = `${code.slice(0, at)}\n    ${options}${empty ? "" : ","}${code.slice(at)}`;
    } else {
      const at = code.indexOf("{") + 1;
      code = `${code.slice(0, at)}\n  "compilerOptions": { ${options} },${code.slice(at)}`;
    }
  }
  return code === text ? undefined : code;
}
