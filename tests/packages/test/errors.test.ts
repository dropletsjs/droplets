/**
 * Every message the framework writes comes from the registry
 * (`@dropletsjs/droplets/errors`): a code, a level, what happened and the
 * fix, with a page at dropletsjs.dev/errors/<code>. This reads the sources
 * of every package but create-droplets (its prompts are not framework
 * messages) and fails on a site that writes a message of its own: a
 * `new Error(…)`, a `console.error` or `console.warn`, a plugin's
 * `this.error` or `this.warn` whose text is not `formatMessage(…)` or
 * `dropletsError(…)`, or any `logger.warn` / `logger.error`. Then it checks
 * the registry: codes unique and kebab-case, each constant named for its
 * code, each code used somewhere and each with its page notes.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as registry from "@dropletsjs/droplets/errors";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const packagesDir = fileURLToPath(new URL("../../../packages/", import.meta.url));

const EXCLUDED = ["create-droplets", "shared"];
const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs"];

/**
 * Sites that pass on a message already formatted elsewhere, by file and the
 * start of the call's text: the worker thread's answer, the runtime's
 * prerender answer, a manifest failure formatted by its caller, a stale
 * build's message, and a coded error `djs` caught.
 */
const PASS_THROUGH = [
  "droplets/src/core/app-thread.ts: new Error(message.error)",
  "droplets/src/vite/prerender.ts: new Error(message)",
  "adapters/node/src/assets.ts: console.error(message)",
  "droplets/src/runtime/entry-client.ts: console.error(error.message)",
  "droplets/src/runtime/dev-element.ts: console.error((error as Error).message)",
  "droplets/src/cli.ts: console.error( coded ? error.message : formatMessage(",
];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    if (name === "node_modules") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const hasSrc = (dir: string) => statSync(dir).isDirectory() && readdirSync(dir).includes("src");

/** `packages/<name>/src`, and `packages/{adapters,renderers}/<name>/src`. */
const sourceRoots = (): string[] =>
  readdirSync(packagesDir)
    .filter((name) => !EXCLUDED.includes(name))
    .flatMap((name) => {
      const dir = join(packagesDir, name);
      if (!statSync(dir).isDirectory()) return [];
      if (hasSrc(dir)) return [join(dir, "src")];
      return readdirSync(dir)
        .map((sub) => join(dir, sub))
        .filter(hasSrc)
        .map((sub) => join(sub, "src"));
    });

const files = sourceRoots()
  .flatMap(walk)
  .filter((file) => EXTENSIONS.some((extension) => file.endsWith(extension)) && !file.endsWith(".d.ts"))
  .map((file) => relative(packagesDir, file))
  .sort();

/** The registry's own files define the messages; every other file uses them. */
const isRegistry = (file: string) => file.startsWith("droplets/src/errors/") || file === "droplets/src/errors.ts";

const read = (file: string) => readFileSync(join(packagesDir, file), "utf8");
const parse = (file: string) =>
  ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : undefined);

/** `formatMessage`, `dropletsError`, and every function declared to return a `DropletsError` (`serverOnlyError`). */
const FORMATTERS = new Set(["formatMessage", "dropletsError"]);
for (const file of files) {
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.type && ts.isTypeReferenceNode(node.type)) {
      if (node.type.typeName.getText() === "DropletsError") FORMATTERS.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
}
const ERRORS = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "AggregateError"]);

const isFormatterCall = (node: ts.Node | undefined): boolean => {
  if (!node) return false;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return isFormatterCall(node.expression);
  if (ts.isCallExpression(node)) return ts.isIdentifier(node.expression) && FORMATTERS.has(node.expression.text);
  // `${formatMessage(…)}\n\n${USAGE}`: the coded message first.
  if (ts.isTemplateExpression(node)) return node.head.text === "" && isFormatterCall(node.templateSpans[0]?.expression);
  return false;
};

/** The sites in one file that write a message not taken from the registry, as `file: code`. */
function bypasses(file: string): string[] {
  const found: string[] = [];
  const source = parse(file);
  const flag = (node: ts.Node) => found.push(`${file}: ${node.getText(source).replace(/\s+/g, " ")}`);
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && ERRORS.has(node.expression.text)) {
      if (!isFormatterCall(node.arguments?.[0])) flag(node);
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const { expression: object, name } = node.expression;
      const method = name.text;
      const on = ts.isIdentifier(object) ? object.text : object.kind === ts.SyntaxKind.ThisKeyword ? "this" : "";
      if (on === "logger" && (method === "warn" || method === "error")) flag(node);
      else if ((on === "console" || on === "this") && (method === "warn" || method === "error")) {
        if (!isFormatterCall(node.arguments[0])) flag(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

type Entry = { code: string; level: string };

const entries = Object.entries(registry as Record<string, unknown>).filter(
  (pair): pair is [string, Entry] =>
    typeof pair[1] === "object" &&
    pair[1] !== null &&
    typeof (pair[1] as Entry).code === "string" &&
    ((pair[1] as Entry).level === "error" || (pair[1] as Entry).level === "warning"),
);

const pages: Record<string, unknown> = Object.assign(
  {},
  ...Object.entries(registry as Record<string, unknown>)
    .filter(([name]) => name.endsWith("_PAGES"))
    .map(([, value]) => value),
);

describe("error messages", () => {
  it("scans every package but create-droplets", () => {
    for (const key of [
      "droplets/src/runtime/app.ts",
      "droplets/src/runtime/entry-client.ts",
      "droplets/src/vite/plugin.ts",
      "droplets/src/core/config.ts",
      "devtools/src/index.ts",
      "adapters/node/src/index.ts",
      "adapters/cloudflare/src/index.ts",
      "renderers/svelte/src/index.ts",
      "renderers/lit/src/index.ts",
    ])
      expect(files, key).toContain(key);
    expect(files.some((file) => file.startsWith("create-droplets/"))).toBe(false);
  });

  it("writes every message through the registry", () => {
    const found = files.filter((file) => !isRegistry(file)).flatMap(bypasses);
    expect(found.filter((site) => !PASS_THROUGH.some((allowed) => site.startsWith(allowed)))).toEqual([]);
  });

  it("gives every entry a unique kebab-case code, its constant named for it", () => {
    expect(entries.length).toBeGreaterThan(100);
    const codes = entries.map(([, entry]) => entry.code);
    expect(codes.filter((code, i) => codes.indexOf(code) !== i)).toEqual([]);
    expect(codes.filter((code) => !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(code))).toEqual([]);
    expect(entries.filter(([name, entry]) => name !== entry.code.toUpperCase().replaceAll("-", "_")).map(([name]) => name)).toEqual([]);
  });

  it("uses every code", () => {
    const sources = files
      .filter((file) => !isRegistry(file))
      .map(read)
      .join("\n");
    const unused = entries.map(([name]) => name).filter((name) => !new RegExp(`\\b${name}\\b`).test(sources));
    expect(unused).toEqual([]);
  });

  it("has the page notes of every code, and none for a code that does not exist", () => {
    const codes = new Set(entries.map(([, entry]) => entry.code));
    expect([...codes].filter((code) => !Object.hasOwn(pages, code))).toEqual([]);
    expect(Object.keys(pages).filter((code) => !codes.has(code))).toEqual([]);
  });
});
