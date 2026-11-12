/**
 * The shape of the sources, not a build: development code is its own
 * module (`packages/droplets/src/runtime/dev-*.ts`, a renderer's
 * `src/client-dev.ts`) and production code reaches it through one gate. A
 * value import of a dev module comes from another dev module, from the
 * build tooling (`src/vite/`, Node code that is never a bundle: the dev
 * server and the prerender log through `dev-log.ts`), or is used only
 * inside `if (import.meta.env.DEV) { … }`, the way `entry-client.ts`
 * installs `installDevElement`; a dynamic `import()` of one sits inside
 * that block too. Each `installDev…` runs at most once per class, and a
 * dev module runs nothing at its top level. Type-only imports are erased
 * and do not count.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const packages = resolve(import.meta.dirname, "../../../packages");

/** Every `.ts`/`.tsx` under a folder, `node_modules` and `dist` left out. */
function sourcesUnder(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !/[\\/](?:node_modules|dist)[\\/]/.test(entry.parentPath))
    .map((entry) => join(entry.parentPath, entry.name));
}

const renderers = readdirSync(join(packages, "renderers"), { withFileTypes: true }).filter((entry) => entry.isDirectory());
const sources = [join(packages, "droplets", "src"), ...renderers.map((entry) => join(entry.parentPath, entry.name, "src"))].flatMap(
  sourcesUnder,
);

const isDevModule = (file: string) => /[\\/]runtime[\\/]dev-[\w-]+\.ts$|[\\/]client-dev\.ts$/.test(file);
const devModules = sources.filter(isDevModule);
const isBuildTooling = (file: string) => /[\\/]droplets[\\/]src[\\/]vite[\\/]/.test(file);

const parse = (file: string) => ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);

/** `if (import.meta.env.DEV)`: the one condition a dev path hides behind. */
function isDevGate(node: ts.Node): node is ts.IfStatement {
  return ts.isIfStatement(node) && node.expression.getText() === "import.meta.env.DEV";
}

const isInsideDevGate = (node: ts.Node) => ts.findAncestor(node.parent, isDevGate) !== undefined;

const place = (file: string, node: ts.Node) =>
  `${relative(packages, file)}:${node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

/** Each identifier use in `source` (declarations and property names left out). */
function usesOf(source: ts.SourceFile, name: string): ts.Identifier[] {
  const uses: ts.Identifier[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === name && !ts.isImportSpecifier(node.parent) && !ts.isPropertyAccessExpression(node.parent)) {
      uses.push(node);
    } else if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.expression.kind !== ts.SyntaxKind.Identifier
    ) {
      uses.push(node.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return uses;
}

/** The dev module a specifier names from `file`, or `undefined` for anything else. */
function devModuleOf(file: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const target = resolve(file, "..", specifier);
  return isDevModule(target) && devModules.includes(target) ? target : undefined;
}

describe("development code enters production code through one gate", () => {
  it("has the dev modules it checks", () => {
    expect(devModules.map((file) => relative(packages, file)).sort()).toEqual(
      expect.arrayContaining([
        "droplets/src/runtime/dev-element.ts",
        "droplets/src/runtime/dev-log.ts",
        "renderers/svelte/src/client-dev.ts",
      ]),
    );
  });

  it("imports a dev module only from a dev module, the build tooling, or for use behind import.meta.env.DEV", () => {
    const offences: string[] = [];
    for (const file of sources) {
      if (isDevModule(file) || isBuildTooling(file)) continue;
      const source = parse(file);
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        if (devModuleOf(file, statement.moduleSpecifier.text) === undefined) continue;
        const clause = statement.importClause;
        if (clause === undefined || clause.isTypeOnly) continue;
        const names: string[] = [];
        if (clause.name) names.push(clause.name.text);
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) if (!element.isTypeOnly) names.push(element.name.text);
        }
        if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) names.push(clause.namedBindings.name.text);
        for (const name of names) {
          const uses = usesOf(source, name);
          if (uses.length === 0) offences.push(`${place(file, statement)}: ${name} imported and never used`);
          for (const use of uses) {
            if (!isInsideDevGate(use)) offences.push(`${place(file, use)}: ${name} used outside if (import.meta.env.DEV)`);
          }
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it("loads a dev module dynamically only behind import.meta.env.DEV", () => {
    const offences: string[] = [];
    for (const file of sources) {
      if (isDevModule(file) || isBuildTooling(file)) continue;
      const source = parse(file);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const [specifier] = node.arguments;
          if (specifier && ts.isStringLiteral(specifier) && devModuleOf(file, specifier.text) !== undefined && !isInsideDevGate(node)) {
            offences.push(`${place(file, node)}: import(${specifier.text}) outside if (import.meta.env.DEV)`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(offences).toEqual([]);
  });

  it("calls each installDev… once per class, behind import.meta.env.DEV", () => {
    const calls = new Map<string, string[]>();
    const offences: string[] = [];
    for (const file of sources) {
      if (isDevModule(file)) continue;
      const source = parse(file);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text.startsWith("installDev")) {
          const [target] = node.arguments;
          const key = `${relative(packages, file)} ${node.expression.text}(${target?.getText() ?? ""})`;
          calls.set(key, [...(calls.get(key) ?? []), place(file, node)]);
          if (!isInsideDevGate(node)) offences.push(`${place(file, node)}: ${node.expression.text} outside if (import.meta.env.DEV)`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    for (const [key, places] of calls) if (places.length > 1) offences.push(`${key} called ${places.length} times: ${places.join(", ")}`);
    expect(offences).toEqual([]);
    expect([...calls.keys()]).toContain("droplets/src/runtime/entry-client.ts installDevElement(DjsDropletElement)");
  });

  it("runs nothing at a dev module's top level", () => {
    const offences: string[] = [];
    for (const file of devModules) {
      for (const statement of parse(file).statements) {
        if (ts.isExpressionStatement(statement)) offences.push(`${place(file, statement)}: ${statement.getText().slice(0, 60)}`);
      }
    }
    expect(offences).toEqual([]);
  });
});
