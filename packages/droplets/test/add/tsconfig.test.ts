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
    const code = await withJsx({ file: join(root, "tsconfig.json"), importSource: "solid-js" });
    expect(code).toContain("// Mine.");
    expect(code).toContain('"include": ["src/**/*.tsx", "src/**/*.ts"');
    const parsed = JSON.parse(stripJsonc({ text: code ?? expect.unreachable("tsconfig.json") })) as {
      compilerOptions: Record<string, unknown>;
    };
    expect(parsed.compilerOptions).toEqual({ jsx: "react-jsx", jsxImportSource: "solid-js", strict: true });
  });

  it("adds compilerOptions when there are none, into an empty object too", async () => {
    const root = project({ "tsconfig.json": `{ "include": ["src"] }`, "empty.json": `{ "compilerOptions": {} }` });
    const parsed = (code: string | undefined) =>
      JSON.parse(stripJsonc({ text: code ?? expect.unreachable("tsconfig.json") })) as { compilerOptions: Record<string, unknown> };
    expect(parsed(await withJsx({ file: join(root, "tsconfig.json"), importSource: "react" })).compilerOptions.jsx).toBe("react-jsx");
    expect(parsed(await withJsx({ file: join(root, "empty.json"), importSource: "react" })).compilerOptions).toEqual({
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
    expect(await withJsx({ file: join(root, "tsconfig.json"), importSource: "react" })).toBeUndefined();
    expect(await withJsx({ file: join(root, "own.json"), importSource: "react" })).toBeUndefined();
    expect(await withJsx({ file: join(root, "missing.json"), importSource: "react" })).toBeUndefined();
  });

  it("strips comments, not what looks like them inside strings", () => {
    expect(JSON.parse(stripJsonc({ text: `{ "a": "//x", /* b */ "c": [1, 2,], }` }))).toEqual({ a: "//x", c: [1, 2] });
  });
});
