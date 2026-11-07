import { describe, expect, it } from "vitest";
import { frameworkNamed } from "../../src/add/catalog.ts";
import { addRenderer } from "../../src/add/vite-config.ts";

const react = frameworkNamed("react")!;
const hono = frameworkNamed("hono-jsx")!;

const config = (renderers: string, extra = "") => `import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { svelte } from "@dropletsjs/renderer-svelte";
${extra}
// The plugins, in order: ăîș.
export default defineConfig({
  plugins: [droplets({ adapter: node(), ${renderers} })],
});
`;

const codeOf = (edit: ReturnType<typeof addRenderer>) => {
  if (!("code" in edit)) throw new Error(`expected code, got:\n${edit.manual}`);
  return edit.code;
};

describe("addRenderer()", () => {
  it("appends the factory to renderers and imports it after the last import, keeping the rest", () => {
    const code = codeOf(addRenderer(config("renderers: [svelte()]"), "vite.config.ts", react));
    expect(code).toContain(`import { svelte } from "@dropletsjs/renderer-svelte";\nimport { react } from "@dropletsjs/renderer-react";\n`);
    expect(code).toContain("renderers: [svelte(), react()]");
    expect(code).toContain("// The plugins, in order: ăîș.");
  });

  it("fills an empty list, adds a missing one, and gives droplets() its options", () => {
    expect(codeOf(addRenderer(config("renderers: []"), "vite.config.ts", hono))).toContain("renderers: [honoJsx()]");
    const added = codeOf(addRenderer(config("css: {}"), "vite.config.ts", hono));
    expect(added).toContain("droplets({ renderers: [honoJsx()], adapter: node(), css: {} })");
    const bare = `import { droplets } from "@dropletsjs/droplets/vite";\nexport default { plugins: [droplets()] };\n`;
    expect(codeOf(addRenderer(bare, "vite.config.js", react))).toContain("droplets({ renderers: [react()] })");
  });

  it("follows droplets() under another name and reads TypeScript", () => {
    const source = `import { droplets as d } from "@dropletsjs/droplets/vite";\nconst mode: string = "x";\nexport default { plugins: [d({ renderers: [] as never[] })] };\n`;
    // `[] as never[]` is not a plain list: left to the user.
    expect(addRenderer(source, "vite.config.ts", react)).toHaveProperty("manual");
    const plain = source.replace(" as never[]", "");
    expect(codeOf(addRenderer(plain, "vite.config.ts", react))).toContain("d({ renderers: [react()] })");
  });

  it("changes nothing when the renderer is there already", () => {
    const source = config("renderers: [svelte(), react()]", `import { react } from "@dropletsjs/renderer-react";`);
    expect(codeOf(addRenderer(source, "vite.config.ts", react))).toBe(source);
  });

  it("leaves configs it cannot read with confidence to the user, with the lines to add", () => {
    const manual = (source: string) => {
      const edit = addRenderer(source, "vite.config.ts", react);
      expect(edit).toEqual({ manual: expect.stringContaining('import { react } from "@dropletsjs/renderer-react";') });
    };
    manual(config("renderers"));
    manual(config("...shared"));
    manual(config("renderers: [svelte()]", `import { react } from "./my-react.ts";`));
    manual(config("renderers: [svelte()]").replace('from "@dropletsjs/droplets/vite"', 'from "./wrapped.ts"'));
    manual(config("renderers: [svelte()]") + "export const other = droplets({});\n");
    manual("export default {{{");
  });
});
