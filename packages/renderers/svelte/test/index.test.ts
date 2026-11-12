import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateRenderers, type ReadFlagsInput } from "@dropletsjs/droplets";
import { readFlags } from "../src/flags.ts";
import { svelte } from "../src/index.ts";

type InputOfInput = { source: string };

const inputOf = ({ source }: InputOfInput): ReadFlagsInput => ({
  kind: "droplet",
  source,
  file: "+droplet.svelte",
  folder: "/app/src/droplets/hello",
  droplet: "hello",
});

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

  it("reads flags from the <script module> block", async () => {
    const source = `<script module lang="ts">\n  export const ssr: boolean = false;\n  export const prerender = true;\n</script>\n<p/>`;
    expect(await readFlags(inputOf({ source }))).toEqual({ ssr: false, prerender: true });
    expect(await readFlags(inputOf({ source: `<script context="module">export const hydrate = false;</script><p/>` }))).toEqual({
      hydrate: false,
    });
    expect(svelte().readFlags).toBe(readFlags);
  });

  it("does not count a commented-out flag, nor one outside the module block", async () => {
    const source = [
      "<!-- <script module>export const hydrate = false</script> -->",
      "<script module>",
      "  // export const ssr = false",
      "  /* export const prerender = true */",
      "</script>",
      "<script>export const hydrate = false;</script>",
      "<p>export const ssr = false</p>",
      `<style lang="scss">// a comment\n$x: red; .a { color: $x; }</style>`,
    ].join("\n");
    expect(await readFlags(inputOf({ source }))).toEqual({});
    expect(await readFlags(inputOf({ source: "<p/>" }))).toBeUndefined();
  });
});
