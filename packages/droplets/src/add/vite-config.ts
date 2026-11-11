/**
 * Adds a renderer to `vite.config.ts`: its import, and `<factory>()` at the
 * end of `droplets({ renderers: [...] })`. The file is parsed (Vite's
 * `parseAst`) and edited as text at the nodes' offsets, so its formatting and
 * comments stay. A config `djs add` cannot read with confidence (no
 * `droplets()` call, `renderers` built elsewhere) is left alone: the result
 * says what to add by hand.
 */
import { parseAst } from "vite";
import type { Framework } from "./catalog.ts";

type Node = { type: string; start: number; end: number; [key: string]: unknown };

export type ConfigEdit = { code: string } | { manual: string };

export type ManualStepsInput = { framework: Pick<Framework, "factory" | "package"> };

type WalkInput = { root: Node };

type KeyNameInput = { property: Node };

type LocalNamesInput = { program: Node };

type LocalNames = { droplets?: string; imports: Map<string, string>; lastImportEnd: number };

export type AddRendererInput = { source: string; file: string; framework: Framework };

/** What to write by hand when the config is not one `djs add` can edit. */
export function manualSteps({ framework }: ManualStepsInput): string {
  return [`import { ${framework.factory} } from "${framework.package}";`, `droplets({ renderers: [/* … */ ${framework.factory}()] })`].join(
    "\n",
  );
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as Node).type === "string";
}

/** Every node under `root`, depth first. */
function* walk({ root }: WalkInput): Generator<Node> {
  yield root;
  for (const [key, value] of Object.entries(root)) {
    if (key === "parent") continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      if (isNode(child)) yield* walk({ root: child });
    }
  }
}

function keyName({ property }: KeyNameInput): string | undefined {
  const key = property["key"] as Node | undefined;
  if (!key || property["computed"]) return undefined;
  if (key.type === "Identifier") return key["name"] as string;
  if (key.type === "Literal" && typeof key["value"] === "string") return key["value"];
  return undefined;
}

/** `droplets` as the config imports it: `import { droplets as d } from "@dropletsjs/droplets/vite"` → `d`. */
function localNames({ program }: LocalNamesInput): LocalNames {
  const imports = new Map<string, string>();
  let droplets: string | undefined;
  let lastImportEnd = 0;
  for (const statement of program["body"] as Node[]) {
    if (statement.type !== "ImportDeclaration") continue;
    lastImportEnd = statement.end;
    const from = (statement["source"] as Node)["value"] as string;
    for (const specifier of statement["specifiers"] as Node[]) {
      const local = (specifier["local"] as Node)["name"] as string;
      imports.set(local, from);
      const imported = specifier["imported"] as Node | undefined;
      if (from === "@dropletsjs/droplets/vite" && imported && imported["name"] === "droplets") droplets = local;
    }
  }
  return { ...(droplets ? { droplets } : {}), imports, lastImportEnd };
}

/** The config with `framework`'s renderer added, or what to add by hand. */
export function addRenderer({ source, file, framework }: AddRendererInput): ConfigEdit {
  const manual = { manual: manualSteps({ framework }) };
  let program: Node;
  try {
    program = parseAst(source, { lang: /\.[cm]?tsx?$/.test(file) ? "ts" : "js" }) as unknown as Node;
  } catch {
    // A config that does not parse is not one to edit: the user adds the renderer by hand.
    return manual;
  }
  const { droplets, imports, lastImportEnd } = localNames({ program });
  if (!droplets) return manual;
  const taken = imports.get(framework.factory);
  if (taken !== undefined && taken !== framework.package) return manual;

  const calls = [...walk({ root: program })].filter(
    (node) =>
      node.type === "CallExpression" && (node["callee"] as Node).type === "Identifier" && (node["callee"] as Node)["name"] === droplets,
  );
  const [call] = calls;
  if (call === undefined || calls.length !== 1) return manual;
  const args = call["arguments"] as Node[];
  const entry = `${framework.factory}()`;

  // Edits as [offset, text], applied from the end so the offsets hold.
  const edits: [number, string][] = [];
  if (args.length === 0) {
    edits.push([call.end - 1, `{ renderers: [${entry}] }`]);
  } else {
    const [options] = args;
    if (options === undefined || options.type !== "ObjectExpression") return manual;
    const properties = options["properties"] as Node[];
    const renderers = properties.find((property) => keyName({ property }) === "renderers");
    if (!renderers) {
      // A spread may carry renderers; a list of our own would replace them.
      if (properties.some((property) => property.type !== "Property")) return manual;
      edits.push([options.start + 1, ` renderers: [${entry}],`]);
    } else {
      const list = renderers["value"] as Node;
      if (list.type !== "ArrayExpression") return manual;
      const elements = (list["elements"] as (Node | null)[]).filter((element): element is Node => element !== null);
      const present = elements.some(
        (element) =>
          element.type === "CallExpression" &&
          (element["callee"] as Node).type === "Identifier" &&
          (element["callee"] as Node)["name"] === framework.factory,
      );
      if (present && taken === framework.package) return { code: source };
      if (present) return manual;
      const last = elements.at(-1);
      edits.push(last ? [last.end, `, ${entry}`] : [list.start + 1, entry]);
    }
  }
  if (taken === undefined) {
    const statement = `import { ${framework.factory} } from "${framework.package}";`;
    edits.push(lastImportEnd > 0 ? [lastImportEnd, `\n${statement}`] : [0, `${statement}\n`]);
  }
  let code = source;
  for (const [offset, text] of edits.sort((a, b) => b[0] - a[0])) {
    code = code.slice(0, offset) + text + code.slice(offset);
  }
  return { code };
}
