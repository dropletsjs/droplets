/**
 * Reading a component's flags (`ssr`, `hydrate`, `prerender`) from its
 * exports. The source is parsed, not scanned: a flag in a comment or a
 * string is no flag, and only a top-level `export const` counts. Build
 * tooling only (it parses with Vite), so it stays out of the runtime entry.
 */
import { parseAst, type ESTree } from "vite";
import { logger } from "./logger.ts";
import type { HydrateMode, RenderFlags } from "../renderer.ts";

/** The language a source is parsed as. */
export type FlagSourceLang = "js" | "jsx" | "ts" | "tsx";

export type LangOfFileInput = { file: string };

type ParseInput = { source: string; lang: FlagSourceLang };

type BindingNamesInput = { pattern: ESTree.BindingPattern | ESTree.BindingRestElement; found: string[] };

type ExportNameInput = { name: ESTree.ModuleExportName };

type ValueExportsInput = { program: ESTree.Program };

type LiteralOfInput = { init: ESTree.Expression | null };

type SourceTextOfInput = { source: string; flag: FlagExport };

type ReadBooleanInput = { source: string; exports: ReadonlyMap<string, FlagExport>; name: string; where: string };

type ReadHydrateInput = { source: string; exports: ReadonlyMap<string, FlagExport>; where: string };

/** `+droplet.tsx` -> `"tsx"`; anything that is not a known script extension parses as TSX, the widest. */
export function langOfFile({ file }: LangOfFileInput): FlagSourceLang {
  const match = file.match(/\.[cm]?([jt]sx?)$/);
  return (match?.[1] as FlagSourceLang | undefined) ?? "tsx";
}

function parse({ source, lang }: ParseInput): ESTree.Program | null {
  try {
    return parseAst(source, { lang });
  } catch {
    // The compiler reports a broken file, with its position.
    return null;
  }
}

function bindingNames({ pattern, found }: BindingNamesInput): void {
  switch (pattern.type) {
    case "Identifier":
      found.push(pattern.name);
      break;
    case "AssignmentPattern":
      bindingNames({ pattern: pattern.left, found });
      break;
    case "RestElement":
      bindingNames({ pattern: pattern.argument, found });
      break;
    case "ObjectPattern":
      for (const property of pattern.properties) {
        bindingNames({ pattern: property.type === "RestElement" ? property : property.value, found });
      }
      break;
    case "ArrayPattern":
      for (const element of pattern.elements) if (element) bindingNames({ pattern: element, found });
      break;
  }
}

function exportName({ name }: ExportNameInput): string {
  return name.type === "Literal" ? name.value : name.name;
}

/** What a flag export holds: the initializer of an `export const`, or `null` for any other form. */
type FlagExport = { init: ESTree.Expression | null; node: ESTree.Node };

/** The value exports of a module, by exported name. */
function valueExports({ program }: ValueExportsInput): Map<string, FlagExport> {
  const exports = new Map<string, FlagExport>();
  for (const statement of program.body) {
    if (statement.type === "ExportAllDeclaration") {
      if (statement.exported && statement.exportKind !== "type") {
        exports.set(exportName({ name: statement.exported }), { init: null, node: statement });
      }
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration" || statement.exportKind === "type") continue;
    const declaration = statement.declaration;
    if (declaration?.type === "VariableDeclaration") {
      if (declaration.declare) continue;
      for (const declarator of declaration.declarations) {
        if (declarator.id.type === "Identifier") {
          const init = declaration.kind === "const" ? declarator.init : null;
          exports.set(declarator.id.name, { init, node: declarator });
          continue;
        }
        const names: string[] = [];
        bindingNames({ pattern: declarator.id, found: names });
        for (const name of names) exports.set(name, { init: null, node: declarator });
      }
    } else if ((declaration?.type === "FunctionDeclaration" || declaration?.type === "ClassDeclaration") && declaration.id) {
      exports.set(declaration.id.name, { init: null, node: declaration });
    } else if (!declaration) {
      for (const specifier of statement.specifiers) {
        if (specifier.exportKind === "type") continue;
        exports.set(exportName({ name: specifier.exported }), { init: null, node: specifier });
      }
    }
  }
  return exports;
}

function literalOf({ init }: LiteralOfInput): boolean | string | undefined {
  if (init?.type !== "Literal") return undefined;
  const value = (init as { value: unknown }).value;
  return typeof value === "boolean" || typeof value === "string" ? value : undefined;
}

function sourceTextOf({ source, flag }: SourceTextOfInput): string {
  return source.slice(flag.init?.start ?? flag.node.start, flag.init?.end ?? flag.node.end).trim();
}

function readBoolean({ source, exports, name, where }: ReadBooleanInput): boolean | undefined {
  const flag = exports.get(name);
  if (!flag) return undefined;
  const value = literalOf({ init: flag.init });
  if (typeof value === "boolean") return value;
  logger.warn("framework", `\`export const ${name}\` must be a literal true or false; ignoring it`, {
    droplet: where,
    found: sourceTextOf({ source, flag }),
  });
  return undefined;
}

function readHydrate({ source, exports, where }: ReadHydrateInput): HydrateMode | undefined {
  const flag = exports.get("hydrate");
  if (!flag) return undefined;
  const value = literalOf({ init: flag.init });
  if (typeof value === "boolean" || value === "visible" || value === "interactive") return value;
  logger.warn("framework", '`export const hydrate` must be true, false, "visible" or "interactive"; ignoring it', {
    droplet: where,
    found: sourceTextOf({ source, flag }),
  });
  return undefined;
}

/**
 * Reads `export const <name> = true|false` from a module's source. Only a
 * boolean literal is understood; any other value, or another form of export,
 * warns and is ignored. `lang` is what the source is parsed as.
 */
export function readExportedFlag(source: string, name: string, where: string, lang: FlagSourceLang = "tsx"): boolean | undefined {
  const program = parse({ source, lang });
  return program ? readBoolean({ source, exports: valueExports({ program }), name, where }) : undefined;
}

/**
 * Reads `export const hydrate = …` from a module's source: a boolean
 * literal, or the string `"visible"` or `"interactive"`.
 */
export function readExportedHydrate(source: string, where: string, lang: FlagSourceLang = "tsx"): HydrateMode | undefined {
  const program = parse({ source, lang });
  return program ? readHydrate({ source, exports: valueExports({ program }), where }) : undefined;
}

/**
 * The flags a module declares (`ssr`, `hydrate`, `prerender`) as top-level
 * `export const` declarations. Absent flags are left out; core applies the
 * defaults. A source that does not parse declares none: its compiler
 * reports it. `where` names the file in warnings.
 *
 * A renderer whose component holds its module code in a block (Svelte's
 * `<script module>`, Vue's plain `<script>`) passes that block's content.
 */
export function readExportedFlags(source: string, where: string, lang: FlagSourceLang = "tsx"): Partial<RenderFlags> {
  const program = parse({ source, lang });
  if (!program) return {};
  const exports = valueExports({ program });
  const flags: Partial<RenderFlags> = {};
  const ssr = readBoolean({ source, exports, name: "ssr", where });
  const hydrate = readHydrate({ source, exports, where });
  const prerender = readBoolean({ source, exports, name: "prerender", where });
  if (ssr !== undefined) flags.ssr = ssr;
  if (hydrate !== undefined) flags.hydrate = hydrate;
  if (prerender !== undefined) flags.prerender = prerender;
  return flags;
}

/** A flag a module exports: the literal it holds, if one, and how the module writes it (`ssr = !dev`, `hydrate` of an `export { hydrate }`). */
export type FlagExportFound = { name: FlagName; value: boolean | string | undefined; written: string };

const FLAG_NAMES = ["ssr", "hydrate", "prerender"] as const;

type FlagName = (typeof FLAG_NAMES)[number];

type ReadFlagExportsInput = { source: string; lang?: FlagSourceLang };

/**
 * Every flag a module exports, whatever its value, as `ssr`, `hydrate`,
 * `prerender`, for a reader that says something else than
 * `readExportedFlags` about it (a script droplet). Warns about nothing.
 */
export function readFlagExports({ source, lang = "tsx" }: ReadFlagExportsInput): FlagExportFound[] {
  const program = parse({ source, lang });
  if (!program) return [];
  const exports = valueExports({ program });
  const found: FlagExportFound[] = [];
  for (const name of FLAG_NAMES) {
    const flag = exports.get(name);
    if (!flag) continue;
    const text = sourceTextOf({ source, flag });
    found.push({ name, value: literalOf({ init: flag.init }), written: flag.init ? `${name} = ${text}` : text });
  }
  return found;
}
