import { existsSync } from "node:fs";
import { type DropletRenderer, importsPackage, validateRenderers } from "@dropletsjs/droplets";
import { readExportedFlags } from "@dropletsjs/droplets/vite";
import { describe, expect, it } from "vitest";
import { preact } from "../src/index.ts";

type OwnerInput = { source: string };

describe("preact()", () => {
  it("claims .tsx and .jsx, lists its packages and points at its built modules", () => {
    const renderer = preact();
    expect(renderer.name).toBe("preact");
    expect(renderer.extensions).toEqual([".tsx", ".jsx"]);
    const byExtension = validateRenderers([renderer]);
    expect(byExtension.get(".tsx")).toEqual([renderer]);
    expect(byExtension.get(".jsx")).toEqual([renderer]);
    expect(renderer.packages).toEqual(["preact", "preact-render-to-string", "@dropletsjs/renderer-preact"]);
    expect(renderer.componentTypes).toBe("@dropletsjs/renderer-preact");
    expect(renderer.server).toMatch(/[\\/]dist[\\/]server\.js$/);
    expect(renderer.client).toMatch(/[\\/]dist[\\/]client\.js$/);
    expect(existsSync(renderer.server), "build the package first").toBe(true);
    expect(existsSync(renderer.client)).toBe(true);
    expect(renderer.clientSetup).toBeUndefined();
    expect((renderer.plugins as (scope: object) => unknown[])({})).toHaveLength(1);
  });

  it("leaves the Vite plugin out when asked", () => {
    expect(preact({ plugin: false }).plugins).toBeUndefined();
  });

  it("reads flags from the component's named exports with the default reader", () => {
    const source = `import { useState } from "preact/hooks";\nexport const ssr = false;\nexport const prerender = true;\nexport default () => <p />;\n`;
    expect(readExportedFlags(source, "x", "tsx")).toEqual({ ssr: false, prerender: true });
    expect(preact().readFlags).toBeUndefined();
  });

  it("shares .tsx with React: a component is Preact's when it imports preact or names it as its JSX source", () => {
    const react = {
      name: "react",
      extensions: [".tsx", ".jsx"],
      packages: ["react", "react-dom"],
      server: "s",
      client: "c",
    } satisfies DropletRenderer;
    const renderer = preact();
    const group = validateRenderers([react, renderer]).get(".tsx") ?? expect.unreachable(".tsx");
    expect(group).toEqual([react, renderer]);
    // Core gives a shared-extension component to the renderer whose package it names.
    const owner = ({ source }: OwnerInput): string[] =>
      group.filter((r) => (r.packages ?? []).some((pkg) => importsPackage(source, pkg))).map((r) => r.name);
    expect(owner({ source: `import { useState } from "preact/hooks";` })).toEqual(["preact"]);
    expect(owner({ source: `/** @jsxImportSource preact */\nexport default () => <p />;` })).toEqual(["preact"]);
    expect(owner({ source: `import { useState } from "react";` })).toEqual(["react"]);
    // A preact-scoped library does not name preact.
    expect(owner({ source: `import { signal } from "@preact/signals";` })).toEqual([]);
  });
});
