/**
 * `render.timeout` through a real Vite: `vite dev`, the prerender of
 * `vite build` (no deadline), and the built server. A project of its own:
 * `fixtures/app` is built by the adapter suites, which a short timeout
 * would break.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBuilder, createServer, type ViteDevServer } from "vite";
import { onFreePort } from "@dropletsjs/shared/vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeRenderer } from "../../src/testing/index.ts";
import { droplets, type DropletsAdapter } from "../../src/vite.ts";

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));

const fakeAdapter: DropletsAdapter = {
  name: "fake",
  serverEntry: resolve(fixtures, "app/fake-entry.js"),
  serverFile: "server.js",
  separateSsrBundle: true,
};

// Waits `props.ms`, or until the request's signal aborts.
const SLOW_LOAD = `export const load = ({ props, request }) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ ms: Number(props.ms ?? 0) }), Number(props.ms ?? 0));
    request.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(request.signal.reason);
    });
  });
`;

type ProjectInput = { root: string };

async function writeProject({ root }: ProjectInput): Promise<void> {
  const slow = join(root, "src/droplets/slow");
  const prerendered = join(root, "src/droplets/slow-prerender");
  await mkdir(slow, { recursive: true });
  await mkdir(prerendered, { recursive: true });
  await writeFile(join(root, "droplets.config.ts"), "export default { render: { timeout: 1000 } };\n");
  await writeFile(join(slow, "+droplet.fake.js"), "export default ({ data }) => `<p>waited ${data.ms}</p>`;\n");
  await writeFile(join(slow, "+error.fake.js"), 'export default ({ error }) => `<p class="oops">${error.status} ${error.message}</p>`;\n');
  await writeFile(join(slow, "+droplet.server.ts"), SLOW_LOAD);
  await writeFile(
    join(prerendered, "+droplet.fake.js"),
    "export const prerender = true;\n\nexport default ({ data }) => `<p>prerendered ${data.ms}</p>`;\n",
  );
  await writeFile(
    join(prerendered, "+droplet.server.ts"),
    "export const load = () => new Promise((resolve) => setTimeout(() => resolve({ ms: 1500 }), 1500));\n",
  );
}

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(fixtures, ".render-timeout-"));
  await writeProject({ root });
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("render.timeout under vite dev", () => {
  let server: ViteDevServer;
  let origin = "";

  beforeAll(async () => {
    server = await onFreePort({
      start: async (port) => {
        const dev = await createServer({
          root,
          configFile: false,
          logLevel: "silent",
          plugins: [droplets({ renderers: [fakeRenderer()] })],
          server: { port, strictPort: true, host: "127.0.0.1" },
        });
        await dev.listen().catch(async (error: unknown) => {
          await dev.close();
          throw error;
        });
        return dev;
      },
    });
    origin = server.resolvedUrls?.local[0]?.replace(/\/$/, "") ?? "";
    // The first render imports the droplet's modules, inside the deadline.
    await fetch(`${origin}/droplets/slow?ms=0`);
  }, 60_000);

  afterAll(async () => {
    await server?.close();
  });

  it("answers 504 with the error page past the timeout, 200 within it", async () => {
    const late = await fetch(`${origin}/droplets/slow?ms=3000`);
    expect(late.status).toBe(504);
    const html = await late.text();
    expect(html).toContain("data-droplet-error");
    expect(html).toContain('<p class="oops">504 Gateway Timeout</p>');

    const fast = await fetch(`${origin}/droplets/slow?ms=0`);
    expect(fast.status).toBe(200);
    expect(await fast.text()).toContain("<p>waited 0</p>");
  });
});

describe("render.timeout in a build", () => {
  beforeAll(async () => {
    const builder = await createBuilder({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [droplets({ adapter: fakeAdapter, renderers: [fakeRenderer()] })],
    });
    await builder.buildApp();
  }, 120_000);

  it("prerenders a droplet whose load takes longer than the timeout", async () => {
    const dir = join(root, "dist/server/_prerendered");
    const index = JSON.parse(await readFile(join(dir, "slow-prerender/index.json"), "utf8")) as Record<string, string>;
    const render = JSON.parse(await readFile(join(dir, index["{}"] ?? ""), "utf8")) as { html: string };
    expect(render.html).toContain("<p>prerendered 1500</p>");
  });

  it("answers 504 from the built server with the config's timeout, and waits with Infinity", async () => {
    const { createServerApp, resolveConfig } = await import("../../src/index.ts");
    const entry = (await import(pathToFileURL(join(root, "dist/server.js")).href)) as { default: { userConfig: object } };
    const ssr = await import(pathToFileURL(join(root, "dist/server/entry-server.js")).href);
    const assets = {
      buildHash: "x",
      loadClientModule: async () => null,
      loadEntryClient: async () => null,
      entryModule: async () => null,
      loadGlobalStyle: async () => null,
      dropletStyles: async () => [],
      loadIndex: async () => null,
      externals: [],
      assetHandler: () => new Response("Not Found", { status: 404 }),
    };
    const config = resolveConfig(entry.default.userConfig);
    expect(config.render).toEqual({ timeout: 1000, rerunLoad: false });
    const app = createServerApp({ ssr, config, assets });
    const late = await app.request("http://drops.test/droplets/slow?ms=3000");
    expect(late.status).toBe(504);
    expect(await late.text()).toContain('<p class="oops">504 Gateway Timeout</p>');

    const patient = createServerApp({
      ssr,
      config: { ...config, render: { timeout: Number.POSITIVE_INFINITY, rerunLoad: false } },
      assets,
    });
    const waited = await patient.request("http://drops.test/droplets/slow?ms=1200");
    expect(waited.status).toBe(200);
    expect(await waited.text()).toContain("<p>waited 1200</p>");
  }, 30_000);
});
