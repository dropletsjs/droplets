import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readExportedFlags, validateRenderers } from "@dropletsjs/droplets";
import { svelte } from "../src/index.ts";

describe("svelte()", () => {
  it("claims .svelte and points at its built server and client modules", () => {
    const renderer = svelte();
    expect(renderer.name).toBe("svelte");
    expect(renderer.extensions).toEqual([".svelte"]);
    expect(validateRenderers([renderer]).get(".svelte")).toEqual([renderer]);
    expect(renderer.server).toMatch(/[\\/]dist[\\/]server\.js$/);
    expect(renderer.client).toMatch(/[\\/]dist[\\/]client\.js$/);
    expect(existsSync(renderer.server), "build the package first").toBe(true);
    expect(existsSync(renderer.client)).toBe(true);
    // The children snippet ships as a .svelte file next to the client module, with its types.
    expect(existsSync(resolve(dirname(renderer.client), "children.svelte"))).toBe(true);
    expect(existsSync(resolve(dirname(renderer.client), "children.svelte.d.ts"))).toBe(true);
    expect(renderer.plugins).toBeDefined();
  });

  it("leaves the Vite plugin out when asked, keeping its own", () => {
    const plugins = ((svelte({ plugin: false }).plugins ?? []) as unknown[]).flat() as Array<{ name: string }>;
    expect(plugins.map((plugin) => plugin.name)).toEqual(["droplets:svelte-options"]);
  });

  it("reads flags from a <script module> block with the default reader", () => {
    const source = `<script module lang="ts">\n  export const ssr = false;\n  export const prerender = true;\n</script>\n<p/>`;
    expect(readExportedFlags(source, "x")).toEqual({ ssr: false, prerender: true });
  });
});
