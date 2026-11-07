import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripJsonc, withJsx } from "../../src/add/tsconfig.ts";

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "djs-tsconfig-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return root;
}

describe("withJsx()", () => {
  it("turns JSX on with the import source and lets .tsx in, keeping comments", async () => {
    const root = project({
      "tsconfig.json": `{\n  // Mine.\n  "compilerOptions": {\n    "strict": true, // on\n  },\n  "include": ["src/**/*.ts", "src/**/*.svelte"],\n}\n`,
    });
    const code = await withJsx(join(root, "tsconfig.json"), "solid-js");
    expect(code).toContain("// Mine.");
    expect(code).toContain('"include": ["src/**/*.tsx", "src/**/*.ts"');
    const parsed = JSON.parse(stripJsonc(code!)) as { compilerOptions: Record<string, unknown> };
    expect(parsed.compilerOptions).toEqual({ jsx: "react-jsx", jsxImportSource: "solid-js", strict: true });
  });

  it("adds compilerOptions when there are none, into an empty object too", async () => {
    const root = project({ "tsconfig.json": `{ "include": ["src"] }`, "empty.json": `{ "compilerOptions": {} }` });
    const parsed = (code: string | undefined) => JSON.parse(stripJsonc(code!)) as { compilerOptions: Record<string, unknown> };
    expect(parsed(await withJsx(join(root, "tsconfig.json"), "react")).compilerOptions.jsx).toBe("react-jsx");
    expect(parsed(await withJsx(join(root, "empty.json"), "react")).compilerOptions).toEqual({
      jsx: "react-jsx",
      jsxImportSource: "react",
    });
  });

  it("needs nothing when jsx is set, here or in a config it extends", async () => {
    const root = project({
      "base.json": `{ "compilerOptions": { "jsx": "preserve" } }`,
      "tsconfig.json": `{ "extends": ["./base"], "include": ["src/**/*"] }`,
      "own.json": `{ "compilerOptions": { "jsx": "react-jsx" } }`,
    });
    expect(await withJsx(join(root, "tsconfig.json"), "react")).toBeUndefined();
    expect(await withJsx(join(root, "own.json"), "react")).toBeUndefined();
    expect(await withJsx(join(root, "missing.json"), "react")).toBeUndefined();
  });

  it("strips comments, not what looks like them inside strings", () => {
    expect(JSON.parse(stripJsonc(`{ "a": "//x", /* b */ "c": [1, 2,], }`))).toEqual({ a: "//x", c: [1, 2] });
  });
});
