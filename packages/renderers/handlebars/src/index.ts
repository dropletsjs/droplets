/**
 * `@dropletsjs/renderer-handlebars`: the Handlebars renderer.
 *
 * ```ts
 * // vite.config.ts
 * import { droplets } from "@dropletsjs/droplets/vite";
 * import { node } from "@dropletsjs/adapter-node";
 * import { handlebars } from "@dropletsjs/renderer-handlebars";
 *
 * export default defineConfig({ plugins: [droplets({ adapter: node(), renderers: [handlebars()] })] });
 * ```
 *
 * `+droplet.hbs` and `+error.hbs` are precompiled at build; only
 * `handlebars/runtime` ships. A template's context is `{ data }` for a
 * droplet and `{ error }` for an error page, like the props of the other
 * engines: `{{data.title}}`, `{{error.message}}`. `{{{children}}}` renders
 * the children marker, where the host's content goes. `@droplet`, `@kind`
 * and `@renderId` are data variables of the render.
 *
 * `+droplet.hbs` declares its flags in a comment, the first thing in it:
 *
 * ```hbs
 * {{!--
 * export hydrate = false
 * export prerender = true
 * --}}
 * ```
 *
 * or on one line: `{{!-- export hydrate = false; export prerender = true --}}`.
 *
 * `+droplet.ts` may declare them instead (`export const ssr = false`), never
 * the same one twice. `+error.hbs` follows the droplet's flags: core ignores
 * any it declares, in its comment or in `+error.ts`. Partials live in `src/partials/*.hbs` and helpers are the exports
 * of `src/handlebars.ts`, on the server and in the browser.
 *
 * `<style>` blocks, inline or `<style src="./x.css">`, are taken out of the
 * template and become the droplet's stylesheet (see `styles.ts`).
 *
 * There is no client behaviour: `hydrate` keeps the server HTML and wires
 * the host's children; `hydrate = false` is the lean choice for a droplet
 * that has neither children nor a browser `load`.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { parseHydrateMode, readExportedFlags, type DropletRenderer, type ReadFlagsInput, type RenderFlags } from "@dropletsjs/droplets";
import { handlebarsPlugin, type HandlebarsRendererOptions } from "./plugin.ts";

export type { HandlebarsRendererOptions, PrecompileOptions } from "./plugin.ts";

/** The context of `+droplet.hbs`: `{{data.…}}`, and `{{form.…}}` after a form action. */
export type DropletContext<Data = unknown, Form = unknown> = { data: Data; form?: Form };

/** The context of `+error.hbs`: `{{error.…}}`. */
export type DropletErrorContext<Err = unknown> = { error: Err };

/** The shape of `src/handlebars.ts`: named exports that are helper functions. */
export type HandlebarsHelpers = Record<string, (...args: never[]) => unknown>;

// `src/` and `dist/` both sit directly under the package root.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The sibling a component's flags would be in: `+droplet.ts`, or `+error.ts`,
 * read only so that core can warn about flags the error page declares.
 */
export function flagsFileFor(kind: ReadFlagsInput["kind"]): string {
  return kind === "droplet" ? "+droplet.ts" : "+error.ts";
}

const FLAG_NAMES = ["ssr", "hydrate", "prerender"] as const;
const FLAG_LINE = /^export\s+(?:const\s+)?(\w+)\s*=\s*(.+)$/;
const MENTIONS_FLAG = /^\s*export\s+(?:const\s+)?(?:ssr|hydrate|prerender)\b/m;

function isFlagName(name: string): name is (typeof FLAG_NAMES)[number] {
  return (FLAG_NAMES as readonly string[]).includes(name);
}

/** Every comment of a parsed template, nested blocks included, in order. */
function commentsOf(program: hbs.AST.Program): hbs.AST.CommentStatement[] {
  const comments: hbs.AST.CommentStatement[] = [];
  class Comments extends Handlebars.Visitor {
    override CommentStatement(comment: hbs.AST.CommentStatement): void {
      comments.push(comment);
    }
  }
  new Comments().accept(program);
  return comments;
}

/** The comment a template opens with, whitespace aside; `undefined` without one. */
function leadingComment(program: hbs.AST.Program): hbs.AST.CommentStatement | undefined {
  for (const node of program.body) {
    if (node.type === "ContentStatement" && !(node as hbs.AST.ContentStatement).value.trim()) continue;
    return node.type === "CommentStatement" ? (node as hbs.AST.CommentStatement) : undefined;
  }
  return undefined;
}

/**
 * The flags a template declares in the comment it opens with, as
 * `export <flag> = true|false` declarations, on lines of their own or on one
 * line. A leading comment without `export`
 * lines is an ordinary comment; one that has them takes nothing else. Flag
 * lines anywhere else are an error, so a misplaced block never goes unseen.
 */
export function readTemplateFlags(source: string, where: string): Partial<RenderFlags> | undefined {
  let program: hbs.AST.Program;
  try {
    program = Handlebars.parse(source);
  } catch {
    // The compiler reports a broken template, with its position.
    return undefined;
  }

  const leading = leadingComment(program);
  for (const comment of commentsOf(program)) {
    if (comment !== leading && MENTIONS_FLAG.test(comment.value)) {
      throw new Error(`droplets: ${where}: flags go in the comment the template starts with, before anything else`);
    }
  }

  // One declaration per line, or several on one line split by `;` or by
  // the next `export`.
  const lines = (leading?.value ?? "")
    .split(/\r?\n|;|\s(?=export\s)/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.some((line) => /^export\b/.test(line))) return undefined;

  const flags: Partial<RenderFlags> = {};
  for (const line of lines) {
    const [, name = "", value = ""] = line.match(FLAG_LINE) ?? [];
    if (!name) {
      throw new Error(`droplets: ${where}: expected \`export <flag> = true|false\` in the flags comment, found "${line}"`);
    }
    if (!isFlagName(name)) {
      throw new Error(`droplets: ${where}: unknown flag "${name}" (expected ${FLAG_NAMES.join(", ")})`);
    }
    if (name in flags) throw new Error(`droplets: ${where}: flag "${name}" is declared twice`);
    if (name === "hydrate") {
      const mode = parseHydrateMode(value);
      if (mode === undefined) {
        throw new Error(`droplets: ${where}: flag "hydrate" must be true, false, "visible" or "interactive", found "${value}"`);
      }
      flags.hydrate = mode;
      continue;
    }
    if (value !== "true" && value !== "false") {
      throw new Error(`droplets: ${where}: flag "${name}" must be true or false, found "${value}"`);
    }
    flags[name] = value === "true";
  }
  return flags;
}

/**
 * Reads `ssr`, `hydrate` and `prerender` from the template's flags comment
 * and from its sibling `.ts` file; a flag declared in both is an error. Core
 * applies the defaults (`ssr` and `hydrate` on, `prerender` off) to what is
 * not there.
 */
export async function readFlags(input: ReadFlagsInput): Promise<Partial<RenderFlags> | undefined> {
  const where = input.kind === "droplet" ? input.droplet : `${input.droplet}/${input.file}`;
  const template = readTemplateFlags(input.source, `${input.droplet}/${input.file}`);
  const sibling = await input.readFile(flagsFileFor(input.kind));
  const declared = sibling === null ? undefined : readExportedFlags(sibling, where);
  if (!template) return declared;
  if (!declared) return template;

  for (const name of FLAG_NAMES) {
    if (name in template && name in declared) {
      throw new Error(
        `droplets: ${input.droplet}: "${name}" is declared in both ${input.file} and ${flagsFileFor(input.kind)}; keep one`,
      );
    }
  }
  return { ...declared, ...template };
}

/** The Handlebars renderer, for `droplets({ renderers: [handlebars()] })`. */
export function handlebars(options: HandlebarsRendererOptions = {}): DropletRenderer {
  return {
    name: "handlebars",
    extensions: [".hbs"],
    packages: ["handlebars", "@dropletsjs/renderer-handlebars"],
    plugins: [handlebarsPlugin(options)],
    server: resolve(packageRoot, "dist/server.js"),
    client: resolve(packageRoot, "dist/client.js"),
    readFlags,
  };
}
