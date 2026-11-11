import { existsSync } from "node:fs";
import { validateRenderers } from "@dropletsjs/droplets";
import { readExportedFlags } from "@dropletsjs/droplets/vite";
import { describe, expect, it } from "vitest";
import { react } from "../src/index.ts";

describe("react()", () => {
  it("claims .tsx and .jsx and points at its built modules", () => {
    const renderer = react();
    expect(renderer.name).toBe("react");
    expect(renderer.extensions).toEqual([".tsx", ".jsx"]);
    const byExtension = validateRenderers([renderer]);
    expect(byExtension.get(".tsx")).toEqual([renderer]);
    expect(byExtension.get(".jsx")).toEqual([renderer]);
    expect(renderer.server).toMatch(/[\\/]dist[\\/]server\.js$/);
    expect(renderer.client).toMatch(/[\\/]dist[\\/]client\.js$/);
    expect(renderer.clientSetup).toMatch(/[\\/]dist[\\/]client-setup\.js$/);
    expect(existsSync(renderer.server), "build the package first").toBe(true);
    expect(existsSync(renderer.client)).toBe(true);
    expect(existsSync(renderer.clientSetup ?? expect.unreachable("clientSetup"))).toBe(true);
    expect(renderer.packages).toEqual(["react", "react-dom", "@dropletsjs/renderer-react"]);
    // A function of core's scope: @vitejs/plugin-react's own array of
    // plugins, then the Fast Refresh that compiles React's modules alone.
    expect(typeof renderer.plugins).toBe("function");
    const plugins = (renderer.plugins as (scope: object) => unknown[])({});
    expect(plugins).toHaveLength(2);
    expect(Array.isArray(plugins[0])).toBe(true);
    expect((plugins[1] as { name: string }).name).toBe("droplets:react-refresh");
  });

  it("takes core's scope when Solid shares .tsx", () => {
    const plugins = (react().plugins as (scope: { include?: RegExp }) => unknown[])({ include: /x/ });
    expect(plugins).toHaveLength(2);
  });

  it("leaves the Vite plugin out when asked", () => {
    expect(react({ plugin: false }).plugins).toBeUndefined();
  });

  it("forwards plugin options", () => {
    // The plugin is opaque; what matters is that the options reach it without throwing.
    const plugins = react({ vitePlugin: { jsxImportSource: "react", exclude: [/\.solid\.tsx$/] } }).plugins;
    expect((plugins as (scope: object) => unknown[])({})).toHaveLength(2);
  });

  it("reads flags from the component's named exports with the default reader", () => {
    const source = `import { useState } from "react";\nexport const ssr = false;\nexport const prerender = true;\nexport default () => <p />;\n`;
    expect(readExportedFlags(source, "x", "tsx")).toEqual({ ssr: false, prerender: true });
    expect(react().readFlags).toBeUndefined();
  });
});
