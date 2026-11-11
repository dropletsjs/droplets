import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateRenderers } from "@dropletsjs/droplets";
import { readExportedFlags } from "@dropletsjs/droplets/vite";
import { honoJsx } from "../src/index.ts";

describe("honoJsx()", () => {
  it("claims .tsx and .jsx, owns hono/jsx (not hono) and points at its built modules", () => {
    const renderer = honoJsx();
    expect(renderer.name).toBe("hono-jsx");
    expect(renderer.extensions).toEqual([".tsx", ".jsx"]);
    expect(validateRenderers([renderer]).get(".tsx")).toEqual([renderer]);
    expect(renderer.packages).toEqual(["hono/jsx", "@dropletsjs/renderer-hono-jsx"]);
    expect(renderer.componentTypes).toBe("@dropletsjs/renderer-hono-jsx");
    expect(renderer.server).toMatch(/[\\/]dist[\\/]server\.js$/);
    expect(renderer.client).toMatch(/[\\/]dist[\\/]client\.js$/);
    expect(existsSync(renderer.server), "build the package first").toBe(true);
    expect(existsSync(renderer.client)).toBe(true);
    expect((renderer.plugins as (scope: object) => unknown[])({})).toHaveLength(1);
  });

  it("leaves the Vite plugin out when asked", () => {
    expect(honoJsx({ plugin: false }).plugins).toBeUndefined();
  });

  it("reads flags from the component's named exports with the default reader", () => {
    const source = `import { useState } from "hono/jsx";\nexport const ssr = false;\nexport default () => <p />;\n`;
    expect(readExportedFlags(source, "x", "tsx")).toEqual({ ssr: false });
    expect(honoJsx().readFlags).toBeUndefined();
  });
});
