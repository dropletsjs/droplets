/**
 * A script droplet through a real `vite build` and `vite dev`, next to a
 * component droplet: its file reaches the browser bundle only, never the
 * server's (it touches `window` at the top level, which would throw there),
 * its server load and the server files behind it stay out of the browser,
 * and its fragment is the client-only one (the context on the element, the
 * data payload and an empty content root), with no script that runs. Any
 * flag it exports warns once and is ignored.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBuilder, createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setLogLevel } from "../../src/core/logger.ts";
import { fakeRenderer } from "../../src/testing/index.ts";
import { droplets, type DropletsAdapter } from "../../src/vite.ts";

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));

const fakeAdapter: DropletsAdapter = {
  name: "fake",
  serverEntry: resolve(fixtures, "app/fake-entry.js"),
  serverFile: "server.js",
  separateSsrBundle: true,
};

const SECRET = "export const secret = 'sk_live_do_not_ship';\n";

const FILES: Record<string, string> = {
  "src/droplets/card/+droplet.fake.js": "export default () => `<p>card</p>`;\n",
  "src/droplets/tracker/+droplet.server.ts": [
    "import { secret } from './db.server.ts';",
    "export const load = ({ props }) => ({ views: 7, page: String(props.page ?? 'home'), checked: secret.length > 0 });",
    "",
  ].join("\n"),
  "src/droplets/tracker/db.server.ts": SECRET,
  "src/droplets/tracker/+droplet.ts": "export const load = ({ data }) => ({ ...data, universal: true });\n",
  "src/droplets/tracker/+droplet.script.ts": [
    "// Browser only: on the server this line would throw.",
    "const seen = window.location.href;",
    "export default (data, el) => {",
    "  el.textContent = `SCRIPT_MARKER ${data.views} ${seen}`;",
    "  return () => {};",
    "};",
    "",
  ].join("\n"),
};

async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(fixtures, ".script-"));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

const build = (root: string) =>
  createBuilder({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [droplets({ adapter: fakeAdapter, renderers: [fakeRenderer()] })],
  }).then((builder) => builder.buildApp());

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/** Every `.js` file under `dir`, as text. */
async function scripts(dir: string): Promise<string> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".js")) out.push(await readFile(join(entry.parentPath, entry.name), "utf8"));
  }
  return out.join("\n");
}

/** What a fragment's `data-droplet-payload="data"` carries. */
const dataOf = (html: string) => {
  const match = html.match(/data-droplet-payload="data">([^<]+)</)?.[1];
  return match ? JSON.parse(Buffer.from(match, "base64").toString()) : undefined;
};

/** The client-only fragment of a script droplet: the context on the element, the data payload, an empty content root. */
function expectScriptFragment(html: string) {
  expect(html).toMatch(
    /^<djs-droplet data-droplet="tracker" data-droplet-build="[^"]+" data-droplet-context="[^"]+"><script type="application\/text" data-droplet-payload="data">[^<]+<\/script><div style="display: contents" data-droplet-entry><\/div><\/djs-droplet>$/,
  );
  // Nothing that runs: the one script is the data payload.
  expect(html.match(/<script\b[^>]*>/g)).toEqual(['<script type="application/text" data-droplet-payload="data">']);
  expect(html).not.toContain("SCRIPT_MARKER");
}

describe("a script droplet in vite build", () => {
  let root: string;

  beforeAll(async () => {
    root = await project(FILES);
    roots.push(root);
    await build(root);
  }, 90_000);

  it("ships the script in its own browser bundle, with the universal load and without the server's", async () => {
    const client = await readFile(join(root, "dist/client/droplets/tracker/client.js"), "utf8");
    const all = await scripts(join(root, "dist/client"));
    expect(all).toContain("SCRIPT_MARKER");
    expect(all).toContain("universal");
    expect(all).not.toContain("sk_live_do_not_ship");
    expect(all).not.toContain("checked:");
    expect(client).toBeTruthy();
    const manifest = JSON.parse(await readFile(join(root, "dist/client/droplets.json"), "utf8"));
    expect(manifest.droplets.tracker.client).toBeTruthy();
  });

  it("keeps the script out of the server bundle, and renders its fragment from the load alone", async () => {
    expect(await scripts(join(root, "dist/server"))).not.toContain("SCRIPT_MARKER");
    expect(existsSync(join(root, "dist/server.js"))).toBe(true);

    const { createServerApp, resolveConfig } = await import("../../src/index.ts");
    const ssr = await import(pathToFileURL(join(root, "dist/server/entry-server.js")).href);
    const app = createServerApp({
      ssr,
      config: resolveConfig({}),
      assets: {
        buildHash: "x",
        loadClientModule: async () => null,
        loadEntryClient: async () => null,
        entryModule: async () => null,
        loadGlobalStyle: async () => null,
        dropletStyles: async () => [],
        loadIndex: async () => null,
        externals: [],
        assetHandler: (c) => c.text("Not Found", 404),
      },
    });
    const response = await app.request("http://drops.test/droplets/tracker?page=pricing");
    expect(response.status).toBe(200);
    const html = await response.text();
    expectScriptFragment(html);
    expect(dataOf(html)).toEqual({ data: { views: 7, page: "pricing", checked: true } });
    // The component droplet next to it renders as usual.
    expect(await (await app.request("http://drops.test/droplets/card")).text()).toContain("<p>card</p>");
  });
});

describe("a script droplet's server files", () => {
  it("fail the build when the script imports one", async () => {
    const root = await project({
      ...FILES,
      "src/droplets/tracker/+droplet.script.ts":
        "import { secret } from './db.server.ts';\nexport default (data, el) => { el.textContent = secret; };\n",
    });
    roots.push(root);
    await expect(build(root)).rejects.toThrow(
      /src\/droplets\/tracker\/db\.server\.ts is server code and cannot reach the browser: .*src\/droplets\/tracker\/\+droplet\.script\.ts -> src\/droplets\/tracker\/db\.server\.ts/,
    );
  }, 90_000);
});

describe("a script droplet's flags", () => {
  it("never fail the build: each warns once, and it stays client only, hydrated, never prerendered", async () => {
    const root = await project({
      ...FILES,
      "src/droplets/tracker/+droplet.script.ts":
        "export const hydrate = false;\nexport const ssr = true;\nexport const prerender = true;\nexport default (data, el) => { el.textContent = 'SCRIPT_MARKER'; };\n",
    });
    roots.push(root);
    setLogLevel("warn");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await build(root);
    } finally {
      setLogLevel("error");
    }
    const ignored = "this is ignored, a script droplet is client only";
    expect(warn.mock.calls.map((call) => String(call[0])).filter((message) => message.includes("+droplet.script.ts exports"))).toEqual([
      `[droplets:framework] tracker/+droplet.script.ts exports ssr = true; ${ignored}`,
      `[droplets:framework] tracker/+droplet.script.ts exports hydrate = false; ${ignored}`,
      `[droplets:framework] tracker/+droplet.script.ts exports prerender = true; ${ignored}`,
    ]);
    const manifest = JSON.parse(await readFile(join(root, "dist/client/droplets.json"), "utf8"));
    expect(manifest.droplets.tracker.client).toBeTruthy();
    expect(await scripts(join(root, "dist/client"))).toContain("SCRIPT_MARKER");
    expect(existsSync(join(root, "dist/server/_prerendered/tracker"))).toBe(false);
    const ssr = await import(pathToFileURL(join(root, "dist/server/entry-server.js")).href);
    expect(ssr.getDropletMeta("tracker")).toEqual({ exists: true, ssr: false, hydrate: true });
    warn.mockRestore();
  }, 90_000);
});

describe("a script droplet in vite dev", () => {
  let server: ViteDevServer;
  let root: string;

  beforeAll(async () => {
    root = await project(FILES);
    roots.push(root);
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

  const api = () =>
    (server.config.plugins.find((plugin) => plugin.name === "droplets") ?? expect.unreachable("the droplets plugin")).api as {
      fetch(request: Request): Promise<Response>;
      renderers(): string[];
      droplets(): { id: string; renderer: string; ssr: unknown; hydrate: unknown; prerender: unknown }[];
    };

  it("is listed with the built-in renderer, which is not among the configured ones", () => {
    expect(api().renderers()).toEqual(["fake"]);
    expect(
      api()
        .droplets()
        .find((d) => d.id === "tracker"),
    ).toMatchObject({ renderer: "script", ssr: false, hydrate: true, prerender: false });
  });

  it("answers the same fragment, without evaluating the script on the server", async () => {
    const html = await (await api().fetch(new Request("http://localhost/droplets/tracker"))).text();
    expectScriptFragment(html);
    // The server load's data; +droplet.ts runs over it again in the browser.
    expect(dataOf(html)).toEqual({ data: { views: 7, page: "home", checked: true } });
  });

  it("serves its browser entry, which imports the script and the built-in renderer", async () => {
    const response = await api().fetch(new Request("http://localhost/droplets/tracker/client.js"));
    expect(response.status).toBe(200);
    const code = await response.text();
    expect(code).toContain("+droplet.script.ts");
    expect(code).toContain("script/client.js");
    expect(code).not.toContain("+droplet.server.ts");
  });

  it("refuses a server file the script imports, as it resolves", async () => {
    await writeFile(join(root, "src/droplets/tracker/leak.ts"), "import { secret } from './db.server.ts';\nexport const n = secret;\n");
    await expect(server.environments.client.transformRequest("/src/droplets/tracker/leak.ts")).rejects.toThrow(
      /src\/droplets\/tracker\/db\.server\.ts is server code/,
    );
  });
});
