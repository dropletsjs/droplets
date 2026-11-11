import type { Plugin } from "vite";
import { describe, expect, it, vi } from "vitest";
import { litPlugin, PREFIX_MODULE, SERVER_BUNDLED, serverBuildOf } from "../src/plugin.ts";

describe("the Vite plugin", () => {
  it("swaps the browser builds of lit-html and @lit/reactive-element for their server twins", () => {
    const all = () => true;
    const base = "/repo/node_modules/.pnpm/lit-html@3.3.3/node_modules/lit-html";
    expect(serverBuildOf({ file: `${base}/lit-html.js`, exists: all })).toBe(`${base}/node/lit-html.js`);
    expect(serverBuildOf({ file: `${base}/development/directive.js`, exists: all })).toBe(`${base}/node/development/directive.js`);
    expect(serverBuildOf({ file: `${base}/node/lit-html.js`, exists: all })).toBeNull();
    expect(serverBuildOf({ file: "/repo/node_modules/@lit/reactive-element/css-tag.js", exists: all })).toBe(
      "/repo/node_modules/@lit/reactive-element/node/css-tag.js",
    );
    expect(serverBuildOf({ file: "/repo/node_modules/lit-element/lit-element.js", exists: all })).toBeNull();
    expect(serverBuildOf({ file: `${base}/lit-html.js`, exists: () => false })).toBeNull();
  });

  it("bundles Lit into server builds only", () => {
    const plugin = litPlugin();
    const configEnvironment = plugin.configEnvironment as (name: string, config: { consumer?: string }) => unknown;
    expect(configEnvironment("client", {})).toBeUndefined();
    expect(configEnvironment("ssr", {})).toEqual({ resolve: { noExternal: SERVER_BUNDLED } });
    expect(configEnvironment("server", { consumer: "server" })).toEqual({ resolve: { noExternal: SERVER_BUNDLED } });
  });

  it("takes the prefix from the droplets element, or from the option", () => {
    const fromCore = litPlugin();
    (fromCore.configResolved as (config: unknown) => void)({ plugins: [{ name: "droplets", api: { element: () => "djs-shop" } }] });
    function load(plugin: Plugin): string | null {
      return (plugin.load as (id: string) => string | null)(`\0${PREFIX_MODULE}`);
    }
    expect(load(fromCore)).toBe('export const prefix = "djs-shop";\n');

    const given = litPlugin({ prefix: "shop-ui" });
    (given.configResolved as (config: unknown) => void)({ plugins: [{ name: "droplets", api: { element: vi.fn(() => "x-y") } }] });
    expect(load(given)).toBe('export const prefix = "shop-ui";\n');
  });
});
