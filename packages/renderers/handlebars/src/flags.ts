import Handlebars from "handlebars";
import { parseHydrateMode, type ReadFlagsInput, type RenderFlags } from "@dropletsjs/droplets";

const FLAG_NAMES = ["ssr", "hydrate", "prerender"] as const;
const FLAG_LINE = /^export\s+(?:const\s+)?(\w+)\s*=\s*(.+)$/;
const MENTIONS_FLAG = /^\s*export\s+(?:const\s+)?(?:ssr|hydrate|prerender)\b/m;

function isFlagName(name: string): name is (typeof FLAG_NAMES)[number] {
  return (FLAG_NAMES as readonly string[]).includes(name);
}

type ProgramInput = { program: hbs.AST.Program };

/** Every comment of a parsed template, nested blocks included, in order. */
function commentsOf({ program }: ProgramInput): hbs.AST.CommentStatement[] {
  const comments: hbs.AST.CommentStatement[] = [];
  // A class: Handlebars walks its AST only through a `Visitor` subclass.
  class Comments extends Handlebars.Visitor {
    override CommentStatement(comment: hbs.AST.CommentStatement): void {
      comments.push(comment);
    }
  }
  new Comments().accept(program);
  return comments;
}

/** The comment a template opens with, whitespace aside; `undefined` without one. */
function leadingComment({ program }: ProgramInput): hbs.AST.CommentStatement | undefined {
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

  const leading = leadingComment({ program });
  for (const comment of commentsOf({ program })) {
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
 * Reads `ssr`, `hydrate` and `prerender` from the template's flags comment.
 * Core applies the defaults (`ssr` and `hydrate` on, `prerender` off) to what
 * is not there.
 */
export function readFlags(input: ReadFlagsInput): Partial<RenderFlags> | undefined {
  return readTemplateFlags(input.source, `${input.droplet}/${input.file}`);
}
