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

type SpecifierInput = { file: string };

/** An absolute path as an import specifier Vite resolves in any environment. */
function specifier({ file }: SpecifierInput): string {
  return JSON.stringify(file.replace(/\\/g, "/"));
}

type InFolderInput = { dir: string; file: string };

function isInside({ dir, file }: InFolderInput): boolean {
  const rel = relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel);
}

/** The partial name of a file under the partials folder. */
export function partialName({ dir, file }: InFolderInput): string {
  return relative(dir, file)
    .replace(/\\/g, "/")
    .replace(/\.hbs$/, "");
}

type ListPartialsInput = { dir: string | null };

/** Every `.hbs` under `dir`, sorted; `[]` when the folder does not exist. */
export function listPartials({ dir }: ListPartialsInput): string[] {
  if (!dir || !existsSync(dir)) return [];
  const found: string[] = [];
  function walk(folder: string): void {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = resolve(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith(".hbs")) found.push(path);
    }
  }
  walk(dir);
  return found.sort();
}

type StyleImportsInput = { file: string; styles: readonly StyleBlock[] };

/** The imports of a template's `<style>` blocks, in order. */
function styleImports({ file, styles }: StyleImportsInput): string[] {
  return styles.map((style, index) =>
    style.kind === "src"
      ? `import ${JSON.stringify(style.src)};`
      : `import ${specifier({ file: styleId({ file, index, lang: style.lang }) })};`,
  );
}

type CompileTemplateInput = {
  source: string;
  file: string;
  setup: boolean;
  styles?: readonly StyleBlock[];
  compile?: PrecompileOptions | undefined;
  runtime?: string;
};

/**
 * A `.hbs` source as a module: `default` is the template function. With
 * `setup`, the module also imports the setup module first, so partials and
 * helpers are registered before the template ever runs. `styles` are its
 * `<style>` blocks, already out of `source`, imported after. The module
 * accepts no HMR update of its own: a template has no state to keep, so an
 * edit propagates to the droplet's client module, which remounts the
 * droplet in place; one that is not hydrated gets its fragment again.
 */
export function compileTemplate({ source, file, setup, styles = [], compile, runtime = runtimeModule }: CompileTemplateInput): string {
  const spec = String(Handlebars.precompile(source, { ...compile, srcName: undefined }));
  return [
    `import { env } from ${specifier({ file: runtime })};`,
    ...(setup ? [`import ${JSON.stringify(SETUP_ID)};`] : []),
    ...styleImports({ file, styles }),
    `// ${file}`,
    `export default env.template(${spec});`,
    "",
  ].join("\n");
}

type SetupModuleCodeInput = {
  partialsDir: string | null;
  partials: readonly string[];
  helpers: string | null;
  runtime?: string;
};

/** The setup module: registers the partials and the helpers into the runtime environment. */
export function setupModuleCode({ partialsDir, partials, helpers, runtime = runtimeModule }: SetupModuleCodeInput): string {
  const lines = [`import { env, registerHelpers } from ${specifier({ file: runtime })};`];
  for (const [i, file] of partials.entries()) lines.push(`import partial_${i} from ${specifier({ file })};`);
  if (helpers) lines.push(`import * as helpers from ${specifier({ file: helpers })};`);
  for (const [i, file] of partials.entries()) {
    if (partialsDir === null) throw new Error("droplets: Handlebars partials without a partials folder");
    lines.push(`env.registerPartial(${JSON.stringify(partialName({ dir: partialsDir, file }))}, partial_${i});`);
  }
  if (helpers) lines.push("registerHelpers({ target: env, module: helpers });");
  lines.push("export { env };", "");
  return lines.join("\n");
}

const DEFAULT_HELPERS = ["src/handlebars.ts", "src/handlebars.js"];

/** The Vite plugin `handlebars()` adds; usable on its own for tests. */
export function handlebarsPlugin(options: HandlebarsRendererOptions = {}): Plugin {
  let partialsDir: string | null = null;
  let helpersFile: string | null = null;
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
      const style = parseStyleId({ id });
      if (style) {
        // An inline `<style>` block: the CSS, read from the template now.
        this.addWatchFile(style.file);
        const { styles } = extractStyles({ source: await readFile(style.file, "utf8"), where: relative(root, style.file) });
        const block = styles[style.index];
        return block?.kind === "inline" ? { code: block.css, map: null } : "";
      }
      if (id !== RESOLVED_SETUP_ID) return;
      const partials = listPartials({ dir: partialsDir });
      const helpers = helpersFile && existsSync(helpersFile) ? helpersFile : null;
      for (const file of [...partials, ...(helpers ? [helpers] : [])]) this.addWatchFile(file);
      return setupModuleCode({ partialsDir, partials, helpers });
    },

    transform(code, id) {
      const [file = id] = id.split("?");
      if (!file.endsWith(".hbs") || parseStyleId({ id })) return;
      const partial = partialsDir !== null && isInside({ dir: partialsDir, file });
      const where = relative(root, file);
      const { template, styles } = extractStyles({ source: code, where });
      if (partial && styles.length > 0) {
        throw new Error(`droplets: ${where}: a partial has no <style>: put it in the droplet templates that use it`);
      }
      return { code: compileTemplate({ source: template, file, setup: !partial, styles, compile: options.compile }), map: null };
    },

    hotUpdate({ file, type }) {
      // A partial appeared or went away, or the helpers module did: the
      // setup module's imports are stale. An edit to either is an ordinary
      // module update, which core traces up to the droplets using it.
      const structural = type !== "update";
      const partial = partialsDir !== null && isInside({ dir: partialsDir, file }) && file.endsWith(".hbs");
      const helpers = helpersFile !== null && file === helpersFile;
      if (structural && (partial || helpers)) {
        const setup = this.environment.moduleGraph.getModuleById(RESOLVED_SETUP_ID);
        if (setup) this.environment.moduleGraph.invalidateModule(setup);
      }
    },
  };
}
