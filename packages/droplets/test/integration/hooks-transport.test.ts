/**
 * `src/hooks.ts`: its `transport` reaches both registries, and the file runs
 * in the browser too, so it stays framework-agnostic and reaches no server
 * code and no Node built-in, refused in a real `vite build` and by the dev
 * server, naming the chain. Under `vite dev` an edit reaches the next
 * request on the server, and the page hears of it.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBuilder, createLogger, createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DropletsManifest } from "../../src/server/manifest.ts";
import { fakeRenderer } from "../../src/testing/index.ts";
import { droplets, type DropletsAdapter } from "../../src/vite.ts";

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));

const fakeAdapter: DropletsAdapter = {
  name: "fake",
  serverEntry: resolve(fixtures, "app/fake-entry.js"),
  serverFile: "server.js",
  separateSsrBundle: true,
};

const MONEY = [
  "export class Money {",
  "  constructor(cents) { this.cents = cents; }",
  "}",
  "export const transport = {",
  "  Money: { encode: (value) => value instanceof Money && { cents: value.cents }, decode: (json) => new Money(json.cents) },",
  "};",
  "",
].join("\n");

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/** A project with one droplet, `card`, whose server load returns a `Money`, and the given files. */
async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(fixtures, ".hooks-transport-"));
  roots.push(root);
  const all: Record<string, string> = {
    "src/droplets/card/+droplet.fake.js": "export default () => `<p>card</p>`;\n",
    "src/droplets/card/+droplet.server.ts":
      "import { Money } from '../../hooks.ts';\nexport const load = () => ({ price: new Money(1250) });\n",
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

/** Builds `root`, the warnings Vite and the plugins logged collected. */
async function build(root: string): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  const customLogger = createLogger("silent");
  customLogger.warn = (message) => void warnings.push(message);
  customLogger.warnOnce = (message) => void warnings.push(message);
  const builder = await createBuilder({
    root,
    configFile: false,
    customLogger,
    plugins: [droplets({ adapter: fakeAdapter, renderers: [fakeRenderer()] })],
  });
  await builder.buildApp();
  return { warnings };
}

describe("vite build", () => {
  it("bundles src/hooks.ts into the client entry and the server, transport and all", async () => {
    const root = await project({ "src/hooks.ts": MONEY });
    await build(root);
    const client = resolve(root, "dist/client");
    const manifest = JSON.parse(await readFile(resolve(client, "droplets.json"), "utf8")) as DropletsManifest;
    expect(await readFile(resolve(client, manifest.__entryModule ?? ""), "utf8")).toContain("cents");
    expect(await readFile(resolve(root, "dist/server/entry-server.js"), "utf8")).toContain("cents");
  }, 90_000);

  it("builds a src/hooks.ts without transport, without a word about it", async () => {
    const root = await project({
      "src/hooks.ts": "export class Money { constructor(cents) { this.cents = cents; } }\n",
      "src/droplets/card/+droplet.server.ts": "export const load = () => ({ cents: 1250 });\n",
    });
    const { warnings } = await build(root);
    expect(warnings.filter((warning) => /transport|universalHooks|MISSING_EXPORT/i.test(warning))).toEqual([]);
  }, 90_000);

  it.each([
    [
      "a *.server.* file",
      { "src/lib/keys.server.ts": "export const key = 'k';\n" },
      "./lib/keys.server.ts",
      /src\/lib\/keys\.server\.ts is server code/,
    ],
    [
      "a file under a server/ folder",
      { "src/lib/server/db.ts": "export const key = 'k';\n" },
      "./lib/server/db.ts",
      /src\/lib\/server\/db\.ts is server code/,
    ],
    [
      "a +server route",
      { "src/api/rates/+server.ts": "export const key = 'k';\n" },
      "./api/rates/+server.ts",
      /src\/api\/rates\/\+server\.ts is server code/,
    ],
  ])(
    "fails when src/hooks.ts reaches %s through a neutral module, naming the chain",
    async (_name, files, target, message) => {
      const root = await project({
        "src/hooks.ts": `import { key } from './lib/rates.ts';\n${MONEY}export const rate = key;\n`,
        "src/lib/rates.ts": `export { key } from '${target.replace("./", "../")}';\n`,
        ...files,
      });
      await expect(build(root)).rejects.toThrow(message);
      await expect(build(root)).rejects.toThrow(/src\/hooks\.ts -> src\/lib\/rates\.ts -> /);
    },
    90_000,
  );

  it.each(["$droplets/server", "$droplets/env/private", "@dropletsjs/droplets/server"])(
    "fails when src/hooks.ts imports %s",
    async (id) => {
      const root = await project({ "src/hooks.ts": `import * as server from '${id}';\n${MONEY}export const kept = server;\n` });
      await expect(build(root)).rejects.toThrow(/can only be imported by server files/);
    },
    90_000,
  );

  it("fails when src/hooks.ts imports a Node built-in, or reaches one, naming the chain", async () => {
    const direct = await project({
      "src/hooks.ts": `import { readFileSync } from 'node:fs';\n${MONEY}export const read = readFileSync;\n`,
    });
    await expect(build(direct)).rejects.toThrow(
      /hooks-imports-node-builtin\n {2}what: src\/hooks\.ts runs in the browser too and cannot reach the Node built-in node:fs: src\/hooks\.ts -> node:fs\n/,
    );
    const chained = await project({
      "src/hooks.ts": `import { join } from './lib/paths.ts';\n${MONEY}export const joined = join;\n`,
      "src/lib/paths.ts": "export { join } from 'path';\n",
    });
    await expect(build(chained)).rejects.toThrow(/cannot reach the Node built-in path: src\/hooks\.ts -> src\/lib\/paths\.ts -> path\n/);
  }, 90_000);

  it("leaves a Node built-in alone when src/hooks.ts does not reach it", async () => {
    const root = await project({
      "src/hooks.ts": MONEY,
      "src/droplets/card/+droplet.server.ts": "import { join } from 'node:path';\nexport const load = () => ({ at: join('a', 'b') });\n",
    });
    await expect(build(root)).resolves.toBeDefined();
  }, 90_000);

  it("fails when src/hooks.ts reaches a renderer's module, naming the chain (Rule 11)", async () => {
    const root = await project({
      "src/hooks.ts": `import { badge } from './lib/badge.ts';\n${MONEY}export const shown = badge;\n`,
      "src/lib/badge.ts": "export { default as badge } from './Badge.fake.js';\n",
      "src/lib/Badge.fake.js": "export default () => '<b>new</b>';\n",
    });
    await expect(build(root)).rejects.toThrow(
      /hooks-imports-framework\n {2}what: src\/hooks\.ts imports fake code: src\/hooks\.ts -> src\/lib\/badge\.ts -> src\/lib\/Badge\.fake\.js\n/,
    );
  }, 90_000);
});

describe("vite dev", () => {
  let server: ViteDevServer;
  let root: string;

  beforeAll(async () => {
    root = await project({
      "src/hooks.ts": [
        "import { read } from './lib/disk.ts';",
        "import { key } from './lib/keys.ts';",
        "import { badge } from './lib/badge.ts';",
        "import { secret } from './lib/secret.ts';",
        "import { fmt } from './lib/fmt.ts';",
        MONEY,
        "export const used = [read, key, badge, secret, fmt];",
        "",
      ].join("\n"),
      "src/lib/disk.ts": "export { readFileSync as read } from 'node:fs';\n",
      "src/lib/keys.ts": "export { key } from './keys.server.ts';\n",
      "src/lib/keys.server.ts": "export const key = 'k';\n",
      "src/lib/badge.ts": "export { default as badge } from './Badge.fake.js';\n",
      "src/lib/Badge.fake.js": "export default () => '<b>new</b>';\n",
      "src/lib/secret.ts": "export { env as secret } from '$droplets/env/private';\n",
      "src/lib/fmt.ts": "export const fmt = (cents) => String(cents);\n",
    });
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [droplets({ renderers: [fakeRenderer()] })],
      server: { middlewareMode: true, hmr: false, watch: null },
    });
  }, 60_000);

  afterAll(async () => {
    await server?.close();
  });

  it("imports src/hooks.ts into both registries for its transport", async () => {
    const client = (await server.environments.client.transformRequest("virtual:droplets"))?.code ?? "";
    expect(client).toMatch(/import \* as universalHooks from "\/src\/hooks\.ts(\?[^"]*)?";/);
    expect(client).toContain('export const transport = Reflect.get(universalHooks, "transport");');
    const ssr = (await server.environments.ssr.transformRequest("virtual:droplets"))?.code ?? "";
    expect(ssr).toContain('"/src/hooks.ts"');
    expect(ssr).toMatch(/const transport = Reflect\.get\(\(0,__vite_ssr_import_\d+__\), "transport"\);/);
  });

  it("refuses each server-only or framework import reached from src/hooks.ts as it resolves, naming the chain", async () => {
    const client = server.environments.client;
    await expect(client.transformRequest("/src/hooks.ts")).resolves.toBeTruthy();
    await expect(client.transformRequest("/src/lib/disk.ts")).rejects.toThrow(
      /src\/hooks\.ts runs in the browser too and cannot reach the Node built-in node:fs: src\/hooks\.ts -> src\/lib\/disk\.ts -> node:fs/,
    );
    await expect(client.transformRequest("/src/lib/keys.ts")).rejects.toThrow(
      /src\/lib\/keys\.server\.ts is server code and cannot reach the browser: .*src\/hooks\.ts -> src\/lib\/keys\.ts -> src\/lib\/keys\.server\.ts/,
    );
    await expect(client.transformRequest("/src/lib/badge.ts")).rejects.toThrow(
      /src\/hooks\.ts imports fake code: src\/hooks\.ts -> src\/lib\/badge\.ts -> src\/lib\/Badge\.fake\.js/,
    );
    await expect(client.transformRequest("/src/lib/secret.ts")).rejects.toThrow(
      /\$droplets\/env\/private can only be imported by server files/,
    );
    await expect(client.transformRequest("/src/lib/fmt.ts")).resolves.toBeTruthy();
  });

  type HotUpdate = (this: { environment: unknown }, options: Record<string, unknown>) => Promise<unknown>;

  const hotUpdate = (): HotUpdate => {
    const plugin = server.config.plugins.find((each) => each.name === "droplets");
    const hook = plugin?.hotUpdate;
    return (typeof hook === "function" ? hook : hook?.handler) as unknown as HotUpdate;
  };

  it("tells the page when src/hooks.ts changes, appears or goes away, and leaves the server's module to Vite", async () => {
    const send = vi.spyOn(server.hot, "send").mockImplementation(() => {});
    const file = resolve(root, "src/hooks.ts");
    for (const type of ["update", "create", "delete"]) {
      send.mockClear();
      const options = { file, modules: [], server, timestamp: Date.now(), type };
      expect(await hotUpdate().call({ environment: server.environments.ssr }, options)).toBeUndefined();
      expect(send).not.toHaveBeenCalled();
      expect(await hotUpdate().call({ environment: server.environments.client }, options)).toEqual([]);
      expect(send).toHaveBeenCalledExactlyOnceWith("droplets:hooks", { reason: "hooks", timestamp: options.timestamp });
    }
    send.mockRestore();
  });

  it("tells the page when a file src/hooks.ts imports changes, with no module update before its reload", async () => {
    const send = vi.spyOn(server.hot, "send").mockImplementation(() => {});
    const client = server.environments.client;
    const file = resolve(root, "src/lib/fmt.ts");
    const modules = [...(client.moduleGraph.getModulesByFile(file) ?? [])];
    expect(modules).not.toEqual([]);
    const options = { file, modules, server, timestamp: Date.now(), type: "update" };
    expect(await hotUpdate().call({ environment: client }, options)).toEqual([]);
    expect(send).toHaveBeenCalledWith("droplets:hooks", { reason: "hooks", timestamp: options.timestamp });
    send.mockRestore();
  });
});

describe("vite dev, a project without src/hooks.ts", () => {
  it("exports transport undefined from both registries, and picks the file up when it appears", async () => {
    const root = await project({ "src/droplets/card/+droplet.server.ts": "export const load = () => ({ cents: 1250 });\n" });
    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [droplets({ renderers: [fakeRenderer()] })],
      server: { middlewareMode: true, hmr: false, watch: null },
    });
    try {
      for (const environment of [server.environments.client, server.environments.ssr]) {
        const code = (await environment.transformRequest("virtual:droplets"))?.code ?? "";
        expect(code).not.toContain("/src/hooks.ts");
        expect(code).toMatch(/const transport = undefined;/);
      }
      const file = resolve(root, "src/hooks.ts");
      await writeFile(file, MONEY);
      const plugin = server.config.plugins.find((each) => each.name === "droplets");
      const hook = plugin?.hotUpdate;
      const hotUpdate = (typeof hook === "function" ? hook : hook?.handler) as unknown as (
        this: { environment: unknown },
        options: Record<string, unknown>,
      ) => Promise<unknown>;
      vi.spyOn(server.hot, "send").mockImplementation(() => {});
      await hotUpdate.call(
        { environment: server.environments.client },
        { file, modules: [], server, timestamp: Date.now(), type: "create" },
      );
      for (const environment of [server.environments.client, server.environments.ssr]) {
        const code = (await environment.transformRequest("virtual:droplets"))?.code ?? "";
        expect(code).toContain('"/src/hooks.ts');
        expect(code).toMatch(/const transport = Reflect\.get\(/);
      }
    } finally {
      vi.restoreAllMocks();
      await server.close();
    }
  }, 60_000);
});

describe("vite dev, an edit to src/hooks.ts", () => {
  it("encodes the next request with the edited transport", async () => {
    const root = await project({ "src/hooks.ts": MONEY });
    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [droplets({ renderers: [fakeRenderer()] })],
      server: { port: 0, host: "127.0.0.1" },
    });
    await server.listen();
    try {
      const base = server.resolvedUrls?.local[0] ?? expect.unreachable("a dev server URL");
      const data = async () => (await fetch(new URL("droplets/card/_data", base))).json();
      expect(await data()).toEqual({ data: { price: { cents: 1250 } }, transported: [[["data", "price"], "Money"]] });
      await writeFile(resolve(root, "src/hooks.ts"), MONEY.replace("{ cents: value.cents }", "{ cents: value.cents, edited: true }"));
      await vi.waitFor(async () => expect(await data()).toMatchObject({ data: { price: { cents: 1250, edited: true } } }), {
        timeout: 15_000,
        interval: 200,
      });
    } finally {
      await server.close();
    }
  }, 60_000);
});
