// @vitest-environment happy-dom
/**
 * `src/hooks.client.ts`: `/index.js` calls its `init` synchronously before
 * it defines the droplet element, never waits for it, and starts the
 * droplets anyway when it throws. Without the file, nothing of it reaches
 * the browser. Real `vite build`s and a dev server.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBuilder, createServer, type ViteDevServer } from "vite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DropletsManifest } from "../../src/server/manifest.ts";
import { fakeRenderer } from "../../src/testing/index.ts";
import { droplets, type DropletsAdapter } from "../../src/vite.ts";

// Under happy-dom `URL` is the browser one, so no `new URL(..., import.meta.url)`.
const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");

const fakeAdapter: DropletsAdapter = {
  name: "fake",
  serverEntry: resolve(fixtures, "app/fake-entry.js"),
  serverFile: "server.js",
  separateSsrBundle: true,
};

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/** A project with one droplet, `card`, its element named `element`, and the given files. */
type ProjectInput = { element: string; files?: Record<string, string> };

async function project({ element, files = {} }: ProjectInput): Promise<string> {
  const root = await mkdtemp(join(fixtures, ".hooks-client-"));
  roots.push(root);
  const all: Record<string, string> = {
    "droplets.config.ts": `export default { element: ${JSON.stringify(element)} };\n`,
    "src/droplets/card/+droplet.fake.js": "export default () => `<p>card</p>`;\n",
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

/** Builds `root`; the manifest, and a reader for files of the client build. */
async function build(root: string) {
  const builder = await createBuilder({
    root,
    logLevel: "silent",
    plugins: [droplets({ adapter: fakeAdapter, renderers: [fakeRenderer()] })],
  });
  await builder.buildApp();
  const client = resolve(root, "dist/client");
  const read = (path: string) => readFile(resolve(client, path), "utf8");
  const manifest = JSON.parse(await read("droplets.json")) as DropletsManifest;
  return { manifest, read, entry: resolve(client, manifest.__entryModule ?? "") };
}

type Trace = { steps: string[] };
const trace = () => ((globalThis as unknown as { __initTrace?: Trace }).__initTrace ??= { steps: [] });

/**
 * `init` for a project whose element is `element`: notes whether the
 * element was defined when it started, then does `body`.
 */
type HooksInput = { element: string; body: string };

const hooks = ({ element, body }: HooksInput) =>
  [
    "const trace = (globalThis.__initTrace ??= { steps: [] });",
    "export function init() {",
    `  trace.steps.push(customElements.get(${JSON.stringify(element)}) ? "init: defined" : "init: not defined");`,
    `  ${body}`,
    "}",
    "",
  ].join("\n");

/** Notes each `customElements.define`, so the order is on record. */
const realDefine = customElements.define.bind(customElements);
customElements.define = (name, element, options) => {
  trace().steps.push(`define ${name}`);
  realDefine(name, element, options);
};

afterEach(() => {
  trace().steps = [];
  vi.restoreAllMocks();
});

describe("without src/hooks.client.ts", () => {
  it("builds /index.js as before: the stub, and an entry without init", async () => {
    const { manifest, read } = await build(await project({ element: "plain-el" }));
    expect(await read("index.js")).toBe(`import("./${manifest.__entryModule}");\n`);
    const entry = await read(manifest.__entryModule ?? "");
    expect(entry).toContain("customElements.define(");
    expect(entry).not.toMatch(/hooks\.client|runClientInit|init\(\) in/);
  }, 90_000);
});

describe("with src/hooks.client.ts", () => {
  it("calls init before the element is defined", async () => {
    const root = await project({
      element: "first-el",
      files: {
        "src/hooks.client.ts": hooks({ element: "first-el", body: 'trace.steps.push("init: done");' }),
      },
    });
    const { entry, read, manifest } = await build(root);
    expect(await read("index.js")).toBe(`import("./${manifest.__entryModule}");\n`);
    expect(await read(manifest.__entryModule ?? "")).not.toMatch(/\bawait\b[^;]*runClientInit/);
    await import(pathToFileURL(entry).href);
    expect(trace().steps).toEqual(["init: not defined", "init: done", "define first-el"]);
    expect(customElements.get("first-el")).toBeDefined();
  }, 90_000);

  it("calls an init in hooks.client.js the same way", async () => {
    const root = await project({
      element: "js-el",
      files: {
        "src/hooks.client.js": hooks({ element: "js-el", body: 'trace.steps.push("init: done");' }),
      },
    });
    await import(pathToFileURL((await build(root)).entry).href);
    expect(trace().steps).toEqual(["init: not defined", "init: done", "define js-el"]);
  }, 90_000);

  it("starts the droplets when init throws, and says so", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const root = await project({
      element: "throw-el",
      files: {
        "src/hooks.client.ts": hooks({ element: "throw-el", body: 'throw new Error("no queue today");' }),
      },
    });
    await import(pathToFileURL((await build(root)).entry).href);
    expect(trace().steps).toEqual(["init: not defined", "define throw-el"]);
    expect(error).toHaveBeenCalledWith(
      "[droplets] init() in src/hooks.client.ts failed; starting the droplets anyway",
      expect.objectContaining({ message: "no queue today" }),
    );
  }, 90_000);

  it("does not wait for a promise init returns, and logs its rejection", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const root = await project({
      element: "promise-el",
      files: {
        "src/hooks.client.ts": hooks({
          element: "promise-el",
          body: 'return new Promise((_, reject) => setTimeout(() => { trace.steps.push("init: rejected"); reject(new Error("too late")); }, 50));',
        }),
      },
    });
    await import(pathToFileURL((await build(root)).entry).href);
    // Defined at once, the promise still pending.
    expect(trace().steps).toEqual(["init: not defined", "define promise-el"]);
    expect(error).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "[droplets] init() in src/hooks.client.ts returned a promise that rejected; init is not waited for",
        expect.objectContaining({ message: "too late" }),
      ),
    );
    expect(trace().steps).toEqual(["init: not defined", "define promise-el", "init: rejected"]);
  }, 90_000);
});

describe("in vite dev", () => {
  let server: ViteDevServer;
  let root: string;

  beforeAll(async () => {
    root = await project({
      element: "dev-el",
      files: { "src/hooks.client.ts": "export const init = () => {};\n" },
    });
    server = await createServer({
      root,
      logLevel: "silent",
      plugins: [droplets({ renderers: [fakeRenderer()] })],
      server: { middlewareMode: true, hmr: false, watch: null },
    });
  }, 60_000);

  afterAll(async () => {
    await server?.close();
  });

  it("imports the file into the browser registry and calls init there", async () => {
    const code = (await server.environments.client.transformRequest("virtual:droplets"))?.code ?? "";
    expect(code).toMatch(/import \* as clientHooks from "\/src\/hooks\.client\.ts(\?[^"]*)?";/);
    expect(code).toContain('runClientInit(clientHooks, "src/hooks.client.ts");');
    expect(code).not.toMatch(/\bawait\b/);
  });

  it("tells the page when the file changes, appears or goes away, never reloading it itself", async () => {
    const send = vi.spyOn(server.hot, "send").mockImplementation(() => {});
    const plugin = server.config.plugins.find((each) => each.name === "droplets");
    const hook = plugin?.hotUpdate;
    const hotUpdate = (typeof hook === "function" ? hook : hook?.handler) as unknown as (
      this: { environment: unknown },
      options: Record<string, unknown>,
    ) => Promise<unknown>;
    const file = resolve(root, "src/hooks.client.ts");
    for (const type of ["update", "create", "delete"]) {
      send.mockClear();
      const options = { file, modules: [], server, timestamp: Date.now(), type };
      // Once per environment: the client's tells the page, the server's
      // ignores it. The page decides: a notice under `hmr`, a reload under
      // `reload` or `remount`. The host's page is never reloaded from here.
      expect(await hotUpdate.call({ environment: server.environments.ssr }, options)).toEqual([]);
      expect(send).not.toHaveBeenCalled();
      expect(await hotUpdate.call({ environment: server.environments.client }, options)).toEqual([]);
      expect(send).toHaveBeenCalledExactlyOnceWith("droplets:hooks-client", { reason: "hooks.client", timestamp: options.timestamp });
    }
  });

  it("leaves the server registry without it", async () => {
    const code = (await server.environments.ssr.transformRequest("virtual:droplets"))?.code ?? "";
    expect(code).not.toContain("hooks.client");
  });

  it("has no init in the registry of a project without the file", async () => {
    const plain = await project({ element: "dev-plain-el" });
    const other = await createServer({
      root: plain,
      logLevel: "silent",
      plugins: [droplets({ renderers: [fakeRenderer()] })],
      server: { middlewareMode: true, hmr: false, watch: null },
    });
    try {
      const code = (await other.environments.client.transformRequest("virtual:droplets"))?.code ?? "";
      expect(code).toContain("export const dropletsById");
      expect(code).not.toMatch(/clientHooks|runClientInit/);
    } finally {
      await other.close();
    }
  });
});
