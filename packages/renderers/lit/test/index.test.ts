import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateRenderers } from "@dropletsjs/droplets";
import { readExportedFlags } from "@dropletsjs/droplets/vite";
import { lit } from "../src/index.ts";

describe("lit()", () => {
  it("claims .lit.ts and .lit.js and points at its built modules", () => {
    const renderer = lit();
    expect(renderer.name).toBe("lit");
    expect(renderer.extensions).toEqual([".lit.ts", ".lit.js"]);
    const byExtension = validateRenderers([renderer]);
    expect(byExtension.get(".lit.ts")).toEqual([renderer]);
    expect(renderer.server).toMatch(/[\\/]dist[\\/]server\.js$/);
    expect(renderer.client).toMatch(/[\\/]dist[\\/]client\.js$/);
    expect(renderer.clientSetup).toMatch(/[\\/]dist[\\/]client-setup\.js$/);
    expect(existsSync(renderer.server), "build the package first").toBe(true);
    expect(existsSync(renderer.client)).toBe(true);
    expect(existsSync(renderer.clientSetup ?? expect.unreachable("clientSetup"))).toBe(true);
    expect(renderer.packages).toContain("lit");
    expect(renderer.packages).toContain("@dropletsjs/renderer-lit");
    expect(renderer.componentTypes).toBe("@dropletsjs/renderer-lit");
    expect(renderer.plugins).toHaveLength(1);
  });

  it("sits next to the renderers that claim .ts-like suffixes: .ts stays core's", () => {
    const tsx = { name: "react", extensions: [".tsx"], packages: ["react"], server: "/s.js", client: "/c.js" };
    expect(() => validateRenderers([lit(), tsx])).not.toThrow();
  });

  it("refuses a prefix outside lowercase letters, digits and hyphens, as its message says", () => {
    for (const prefix of ["My Shop", "1shop", "my.shop", "my_shop", "my-shop!", ""]) {
      expect(() => lit({ prefix }), prefix).toThrow(/must start with a lowercase letter: lowercase letters, digits, hyphens/);
    }
    for (const prefix of ["shop", "my-shop", "shop2", "a"]) {
      expect(() => lit({ prefix }), prefix).not.toThrow();
    }
  });

  it("reads flags from the component's named exports with the default reader", () => {
    const source = `import { LitElement } from "lit";\nexport const ssr = false;\nexport const hydrate = "visible";\nexport default class X extends LitElement {}\n`;
    expect(readExportedFlags(source, "hello", "ts")).toEqual({ ssr: false, hydrate: "visible" });
  });
});
