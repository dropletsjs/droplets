import { existsSync } from "node:fs";
import { type ReadFlagsInput, validateRenderers } from "@dropletsjs/droplets";
import { describe, expect, it } from "vitest";
import { readFlags, vue } from "../src/index.ts";

type InputOfInput = { source: string };

const inputOf = ({ source }: InputOfInput): ReadFlagsInput => ({
  kind: "droplet",
  source,
  file: "+droplet.vue",
  folder: "/app/src/droplets/hello",
  droplet: "hello",
});

describe("vue()", () => {
  it("claims .vue and points at its built server and client modules", () => {
    const renderer = vue();
    expect(renderer.name).toBe("vue");
    expect(renderer.extensions).toEqual([".vue"]);
    expect(validateRenderers([renderer]).get(".vue")).toEqual([renderer]);
    expect(renderer.server).toMatch(/[\\/]dist[\\/]server\.js$/);
    expect(renderer.client).toMatch(/[\\/]dist[\\/]client\.js$/);
    expect(existsSync(renderer.server), "build the package first").toBe(true);
    expect(existsSync(renderer.client)).toBe(true);
    expect(renderer.plugins).toHaveLength(1);
  });

  it("leaves the Vite plugin out when asked", () => {
    expect(vue({ plugin: false }).plugins).toBeUndefined();
  });

  it("forwards plugin options", () => {
    // The plugin is opaque; what matters is that the options reach it without throwing.
    expect(vue({ vitePlugin: { features: { customElement: /\.ce\.vue$/ } } }).plugins).toHaveLength(1);
    expect(vue({ vitePlugin: { customElement: true } }).plugins).toHaveLength(1);
  });

  it("reads flags from a plain <script> block with the default reader", () => {
    const source = [
      `<script lang="ts">`,
      `export const ssr = false;`,
      `export const prerender = true;`,
      `</script>`,
      `<script setup lang="ts">`,
      `defineProps<{ data: unknown }>();`,
      `</script>`,
      `<template><p>{{ data }}</p></template>`,
    ].join("\n");
    expect(readFlags(inputOf({ source }))).toEqual({ ssr: false, prerender: true });
    expect(vue().readFlags).toBe(readFlags);
  });

  it("reads the plain <script> block only: comments, <script setup> and the template never count", () => {
    const source = [
      "<!-- <script>export const ssr = false</script> -->",
      `<script lang="ts">`,
      "// export const prerender = true",
      "export const hydrate = false;",
      `</script>`,
      `<script setup lang="ts">const ssr = false;</script>`,
      `<template><p>export const prerender = true</p></template>`,
    ].join("\n");
    expect(readFlags(inputOf({ source }))).toEqual({ hydrate: false });
    expect(readFlags(inputOf({ source: `<template><p/></template>` }))).toBeUndefined();
  });
});
