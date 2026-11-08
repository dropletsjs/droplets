/**
 * The Vite plugin: precompiles every `.hbs` file with `Handlebars.precompile`
 * into a module whose `default` is the template function, built on the
 * shared runtime environment (`runtime.ts`). Only `handlebars/runtime` ships
 * to the server bundle and the browser; the compiler stays in Node.
 *
 * Two kinds of `.hbs` modules:
 *
 * - A partial, under the partials folder (`src/partials` by default): just
 *   the template. The setup module registers it by its path relative to the
 *   folder, without `.hbs`: `src/partials/card.hbs` is `{{> card}}`,
 *   `src/partials/layout/header.hbs` is `{{> layout/header}}`.
 * - Anything else (`+droplet.hbs`, `+error.hbs`): the template, plus a
 *   side-effect import of `virtual:droplets-handlebars/setup`, the generated
 *   module that registers the partials and the helpers of
 *   `src/handlebars.ts` into the runtime environment. It is one module, so
 *   registration runs once per bundle however many droplets use it. Its
 *   `<style>` blocks are taken out and imported (`styles.ts`).
 */
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import type { Plugin } from "vite";
import { extractStyles, parseStyleId, styleId, type StyleBlock } from "./styles.ts";

/** What `Handlebars.precompile` accepts as options. */
export type PrecompileOptions = NonNullable<Parameters<typeof Handlebars.precompile>[1]>;

export type HandlebarsRendererOptions = {
  /**
   * The folder of the partials, relative to the Vite root. Every `.hbs` in
   * it (and below) is registered by its path without the extension.
   * Default `src/partials`; `false` for none.
   */
  partials?: string | false;
  /**
   * The module exporting the helpers, relative to the Vite root: every
   * exported function is a helper of the same name, on the server and in
   * the browser. Default `src/handlebars.ts` (or `.js`) when it exists;
   * `false` for none.
   */
  helpers?: string | false;
  /** Options for `Handlebars.precompile`: `strict`, `noEscape`, `preventIndent`, … */
  compile?: PrecompileOptions;
};

/** The id droplet templates import for the partials and helpers. */
export const SETUP_ID = "virtual:droplets-handlebars/setup";
const RESOLVED_SETUP_ID = `\0${SETUP_ID}`;

// `src/` and `dist/` both sit directly under the package root.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The built runtime module compiled templates import `env` from. */
export const runtimeModule = resolve(packageRoot, "dist/runtime.js");

/** An absolute path as an import specifier Vite resolves in any environment. */
const specifier = (file: string): string => JSON.stringify(file.replace(/\\/g, "/"));

const isInside = (dir: string, file: string): boolean => {
  const rel = relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel);
};

/** The partial name of a file under the partials folder. */
export function partialName(dir: string, file: string): string {
  return relative(dir, file).replace(/\\/g, "/").replace(/\.hbs$/, "");
}

/** Every `.hbs` under `dir`, sorted; `[]` when the folder does not exist. */
export function listPartials(dir: string | null): string[] {
  if (!dir || !existsSync(dir)) return [];
  const files: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = resolve(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith(".hbs")) files.push(path);
    }
  };
  walk(dir);
  return files.sort();
}

/** The imports of a template's `<style>` blocks, in order. */
function styleImports(file: string, styles: StyleBlock[]): string[] {
  return styles.map((style, index) =>
    style.kind === "src"
      ? `import ${JSON.stringify(style.src)};`
      : `import ${specifier(styleId(file, index, style.lang))};`,
  );
}

/**
 * A `.hbs` source as a module: `default` is the template function. With
 * `setup`, the module also imports the setup module first, so partials and
 * helpers are registered before the template ever runs. `styles` are its
 * `<style>` blocks, already out of `source`, imported after. With `dev`, the
 * module accepts its own HMR updates: core re-mounts the droplet on
 * `droplets:update`, so Vite has nothing more to do than swap the module.
 */
export function compileTemplate(
  source: string,
  file: string,
  options: { setup: boolean; styles?: StyleBlock[]; dev?: boolean; compile?: PrecompileOptions; runtime?: string },
): string {
  const spec = Handlebars.precompile(source, { ...options.compile, srcName: undefined }) as unknown as string;
  return [
    `import { env } from ${specifier(options.runtime ?? runtimeModule)};`,
    ...(options.setup ? [`import ${JSON.stringify(SETUP_ID)};`] : []),
    ...styleImports(file, options.styles ?? []),
    `// ${file}`,
    `export default env.template(${spec});`,
    ...(options.dev ? ["if (import.meta.hot) import.meta.hot.accept();"] : []),
    "",
  ].join("\n");
}

/** The setup module: registers the partials and the helpers into the runtime environment. */
export function setupModuleCode(input: {
  partialsDir: string | null;
  partials: string[];
  helpers: string | null;
  runtime?: string;
}): string {
  const lines = [`import { env, registerHelpers } from ${specifier(input.runtime ?? runtimeModule)};`];
  input.partials.forEach((file, i) => {
    lines.push(`import partial_${i} from ${specifier(file)};`);
  });
  if (input.helpers) lines.push(`import * as helpers from ${specifier(input.helpers)};`);
  input.partials.forEach((file, i) => {
    lines.push(`env.registerPartial(${JSON.stringify(partialName(input.partialsDir!, file))}, partial_${i});`);
  });
  if (input.helpers) lines.push("registerHelpers(env, helpers);");
  lines.push("export { env };", "");
  return lines.join("\n");
}

const DEFAULT_HELPERS = ["src/handlebars.ts", "src/handlebars.js"];

/** The Vite plugin `handlebars()` adds; usable on its own for tests. */
export function handlebarsPlugin(options: HandlebarsRendererOptions = {}): Plugin {
  let partialsDir: string | null = null;
  let helpersFile: string | null = null;
  let dev = false;
  let root = process.cwd();

  return {
    name: "droplets:handlebars",
    // Before Vite's import analysis parses the module, and before anything
    // else looks at a `.hbs` file.
    enforce: "pre",

    config(_config, { command }) {
      if (command !== "build") return;
      // `handlebars/runtime` is a dependency of this package, not of the
      // app: bundle it into the server builds instead of leaving an import
      // the app's node_modules may not resolve (pnpm) or the platform cannot
      // (Workers).
      const noExternal = ["handlebars", /^handlebars\//];
      return {
        environments: {
          ssr: { resolve: { noExternal } },
          server: { resolve: { noExternal } },
        },
      };
    },

    configResolved(config) {
      dev = config.command === "serve";
      root = config.root;
      partialsDir = options.partials === false ? null : resolve(config.root, options.partials ?? "src/partials");
      if (options.helpers === false) helpersFile = null;
      else if (options.helpers) helpersFile = resolve(config.root, options.helpers);
      else helpersFile = DEFAULT_HELPERS.map((f) => resolve(config.root, f)).find((f) => existsSync(f)) ?? null;
    },

    resolveId(id) {
      return id === SETUP_ID ? RESOLVED_SETUP_ID : undefined;
    },

    async load(id) {
      const style = parseStyleId(id);
      if (style) {
        // An inline `<style>` block: the CSS, read from the template now.
        this.addWatchFile(style.file);
        const { styles } = extractStyles(await readFile(style.file, "utf8"), relative(root, style.file));
        const block = styles[style.index];
        return block?.kind === "inline" ? { code: block.css, map: null } : "";
      }
      if (id !== RESOLVED_SETUP_ID) return;
      const partials = listPartials(partialsDir);
      const helpers = helpersFile && existsSync(helpersFile) ? helpersFile : null;
      for (const file of [...partials, ...(helpers ? [helpers] : [])]) this.addWatchFile(file);
      return setupModuleCode({ partialsDir, partials, helpers });
    },

    transform(code, id) {
      const file = id.split("?")[0]!;
      if (!file.endsWith(".hbs") || parseStyleId(id)) return;
      const partial = partialsDir !== null && isInside(partialsDir, file);
      const where = relative(root, file);
      const { template, styles } = extractStyles(code, where);
      if (partial && styles.length > 0) {
        throw new Error(`droplets: ${where}: a partial has no <style>: put it in the droplet templates that use it`);
      }
      return { code: compileTemplate(template, file, { setup: !partial, styles, dev, compile: options.compile }), map: null };
    },

    hotUpdate({ file, type }) {
      // A partial appeared or went away, or the helpers module did: the
      // setup module's imports are stale. An edit to either is an ordinary
      // module update, which core traces up to the droplets using it.
      const structural = type !== "update";
      const partial = partialsDir !== null && isInside(partialsDir, file) && file.endsWith(".hbs");
      const helpers = helpersFile !== null && file === helpersFile;
      if (structural && (partial || helpers)) {
        const setup = this.environment.moduleGraph.getModuleById(RESOLVED_SETUP_ID);
        if (setup) this.environment.moduleGraph.invalidateModule(setup);
      }
    },
  };
}
