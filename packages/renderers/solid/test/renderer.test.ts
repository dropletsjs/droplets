import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type PluginOption, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateRenderers } from "@dropletsjs/droplets";
import { readExportedFlags } from "@dropletsjs/droplets/vite";
import { solid } from "../src/index.ts";

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/app");

describe("solid()", () => {
  it("claims .tsx and .jsx and points at its built modules", () => {
    const renderer = solid();
    expect(renderer.name).toBe("solid");
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
    expect(renderer.packages).toEqual(["solid-js", "@dropletsjs/renderer-solid"]);
    expect((renderer.plugins as (scope: object) => unknown[])({})).toHaveLength(1);
  });

  it("leaves the Vite plugin out when asked", () => {
    expect(solid({ plugin: false }).plugins).toBeUndefined();
  });

  it("reads flags from the component's named exports with the default reader", () => {
    const source = `import { createSignal } from "solid-js";\nexport const ssr = false;\nexport const prerender = true;\nexport default () => <p />;\n`;
    expect(readExportedFlags(source, "x", "tsx")).toEqual({ ssr: false, prerender: true });
  });
});

describe("the Vite plugin, per environment", () => {
  let server: ViteDevServer;
  const component = resolve(fixture, "src/droplets/hello/+droplet.tsx");

  beforeAll(async () => {
    server = await createServer({
      root: fixture,
      configFile: false,
      logLevel: "silent",
      server: { middlewareMode: true, hmr: false },
      plugins: (solid().plugins as (scope: object) => PluginOption[])({}),
      // Like core's builds: the browser bundle and two server-side bundles.
      environments: { ssr: { consumer: "server" }, server: { consumer: "server" } },
    });
  });

  afterAll(async () => {
    await server.close();
  });

  const compile = async (environment: string) => {
    const result = await (server.environments[environment] ?? expect.unreachable(environment)).transformRequest(component);
    expect(result, environment).toBeTruthy();
    return (result ?? expect.unreachable(environment)).code;
  };

  it("compiles SSR output, keyed for hydration, where the consumer is the server", async () => {
    for (const environment of ["ssr", "server"]) {
      const code = await compile(environment);
      expect(code, environment).toMatch(/ssrHydrationKey/);
      expect(code, environment).not.toMatch(/getNextElement|template\(/);
    }
  });

  it("compiles hydratable DOM output for the browser", async () => {
    const code = await compile("client");
    expect(code).toMatch(/getNextElement/);
    expect(code).toMatch(/runHydrationEvents/);
    expect(code).not.toMatch(/ssrHydrationKey/);
  });
});
