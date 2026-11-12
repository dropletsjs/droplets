/**
 * Every markup attribute the framework reads or writes is `data-droplet`
 * (the id) or `data-droplet-*`: the fragment the server writes, what the
 * element reads from a host's markup, the renderers' markers and the
 * devtools' own pages. This reads the sources of the runtime, the renderers
 * and the devtools and fails on any other `data-*` name in a string, a
 * template, a JSX attribute or a `dataset` access. A fixture's or a host
 * framework's attribute (`data-testid`, Solid's `data-hk`) may be named in a
 * comment, never in code.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const packagesDir = fileURLToPath(new URL("../../../packages/", import.meta.url));

/** The folders scanned, every file under them with one of `EXTENSIONS`. */
const SCANNED = [
  "droplets/src/runtime",
  "devtools/src",
  "renderers/svelte/src",
  "renderers/vue/src",
  "renderers/react/src",
  "renderers/preact/src",
  "renderers/solid/src",
  "renderers/hono-jsx/src",
  "renderers/handlebars/src",
  "renderers/lit/src",
];

const EXTENSIONS = [".ts", ".tsx", ".js", ".css", ".svelte"];

/** Files the scan must reach: the ones that read or write the attributes. A move of one changes `SCANNED`. */
const KEY_FILES = [
  "droplets/src/runtime/element.ts",
  "droplets/src/runtime/entry-client.ts",
  "droplets/src/runtime/enhance.ts",
  "droplets/src/runtime/dev-element.ts",
  "droplets/src/runtime/dev-notify.ts",
  "devtools/src/page.tsx",
  "devtools/src/page.css",
  "devtools/src/client/devtools-page.ts",
  "devtools/src/tool/panel.ts",
  "renderers/vue/src/client.ts",
  "renderers/svelte/src/children.svelte",
];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));

const files = SCANNED.flatMap((folder) => walk(join(packagesDir, folder)))
  .filter((file) => EXTENSIONS.some((extension) => file.endsWith(extension)))
  .map((file) => relative(packagesDir, file))
  .sort();

const ATTRIBUTE = /data-[a-z][a-z0-9-]*/g;

const allowedAttribute = (name: string) => name === "data-droplet" || name.startsWith("data-droplet-");
/** `dataset.droplet`, `dataset["dropletProps"]`: `droplet`, or `droplet` followed by a capital. */
const allowedDatasetKey = (key: string) => key === "droplet" || /^droplet[A-Z]/.test(key);

type Found = { file: string; name: string };

/** The `data-*` names a TypeScript or JavaScript source reads or writes, by what the code does with them. */
function scanScript(file: string, code: string): Found[] {
  const found: Found[] = [];
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : undefined);
  const text = (value: string) => {
    for (const name of value.match(ATTRIBUTE) ?? []) found.push({ file, name });
  };
  const datasetKey = (key: string) => found.push({ file, name: `dataset.${key}` });
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) text(node.text);
    else if (ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) text(node.text);
    else if (ts.isJsxAttribute(node)) {
      const name = ts.isIdentifier(node.name) ? node.name.text : node.name.getText(source);
      if (name.startsWith("data-")) found.push({ file, name });
    } else if (ts.isPropertyAccessExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (node.expression.name.text === "dataset") datasetKey(node.name.text);
    } else if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "dataset") {
      datasetKey(node.name.text);
    } else if (ts.isElementAccessExpression(node)) {
      const object = node.expression;
      const isDataset =
        (ts.isPropertyAccessExpression(object) && object.name.text === "dataset") || (ts.isIdentifier(object) && object.text === "dataset");
      if (isDataset && ts.isStringLiteral(node.argumentExpression)) datasetKey(node.argumentExpression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The `data-*` names in a stylesheet or a Svelte component, comments left out. */
function scanMarkup(file: string, code: string): Found[] {
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");
  return (stripped.match(ATTRIBUTE) ?? []).map((name) => ({ file, name }));
}

const offending = ({ name }: Found) =>
  name.startsWith("dataset.") ? !allowedDatasetKey(name.slice("dataset.".length)) : !allowedAttribute(name);

describe("markup attributes", () => {
  it("scans the runtime, the renderers and the devtools", () => {
    for (const key of KEY_FILES) expect(files, key).toContain(key);
  });

  it("reads and writes data-droplet and data-droplet-* only", () => {
    const found = files.flatMap((file) => {
      const code = readFileSync(join(packagesDir, file), "utf8");
      return file.endsWith(".css") || file.endsWith(".svelte") ? scanMarkup(file, code) : scanScript(file, code);
    });
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter(offending).map(({ file, name }) => `${file}: ${name}`)).toEqual([]);
  });
});
