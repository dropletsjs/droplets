/**
 * An entry's `file`: with `location` and `host` both set, `vite build`
 * writes the render as `dist/client/assets/prerendered/<id>/<file>.html`,
 * the body a server over the stored renders answers for its props; without
 * both, it writes none and warns once.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBuilder } from "vite";
import { afterAll, afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { logger } from "../../src/core/logger.ts";
import { fakeRenderer } from "../../src/testing/index.ts";
import { droplets, type DropletsAdapter } from "../../src/vite.ts";

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));

type AdapterInput = { separateSsrBundle: boolean };

/** A Node-like adapter (`dist/server`) or a Worker-like one (renders in the client build). */
const fakeAdapter = ({ separateSsrBundle }: AdapterInput): DropletsAdapter => ({
  name: "fake",
  serverEntry: resolve(fixtures, "app/fake-entry.js"),
  serverFile: "server.js",
  separateSsrBundle,
});

const FIXED = 'export default { location: "https://cdn.test/mfe", host: "https://shop.test" };\n';

const COMPONENT =
  'import "./page.css";\n\nexport const prerender = true;\n\nexport default ({ data }) => `<p class="page">${data.page} ${data.home}</p>`;\n';

const LOAD =
  'import droplet from "$droplets/drop";\nexport const load = ({ props }) => ({ page: props.page ?? 0, home: droplet.url("/api/x") });\n';

type ProjectInput = { server: string; config?: string; component?: string; universal?: string };

/** A project with one prerendered droplet, `page`; `server` is its `+droplet.server.ts`, `config` its `droplets.config.ts`. */
async function project({ server, config, component = COMPONENT, universal }: ProjectInput): Promise<string> {
  const root = await mkdtemp(join(fixtures, ".prerender-files-"));
  roots.push(root);
  const folder = join(root, "src/droplets/page");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "+droplet.fake.js"), component);
  await writeFile(join(folder, "page.css"), ".page { color: teal; }\n");
  await writeFile(join(folder, "+droplet.server.ts"), server);
  if (universal) await writeFile(join(folder, "+droplet.ts"), universal);
  if (config) await writeFile(join(root, "droplets.config.ts"), config);
  return root;
}

type BuildInput = { root: string; separateSsrBundle?: boolean };

const build = ({ root, separateSsrBundle = true }: BuildInput) =>
  createBuilder({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [droplets({ adapter: fakeAdapter({ separateSsrBundle }), renderers: [fakeRenderer()] })],
  }).then((builder) => builder.buildApp());

type FilesInput = { root: string };

/** The prerender files of the build, relative to `dist/client/assets/prerendered`. */
async function prerenderFiles({ root }: FilesInput): Promise<string[]> {
  const dir = join(root, "dist/client/assets/prerendered");
  if (!existsSync(dir)) return [];
  return (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath.slice(dir.length + 1)}/${entry.name}`)
    .sort();
}

type FileInput = { root: string; path: string };

const fileText = ({ root, path }: FileInput) => readFile(join(root, "dist/client/assets/prerendered", path), "utf8");

type ServerAnswerInput = { root: string; renders: string; config: Record<string, unknown>; props: Record<string, unknown> };

/** What a production server over the stored renders answers to `POST /droplets/page` with `props`. */
async function serverAnswer({ root, renders, config, props }: ServerAnswerInput): Promise<string> {
  const { createPrerenderedLoader, createServerApp, resolveConfig } = await import("../../src/index.ts");
  const ssr = await import(pathToFileURL(join(root, "dist/server/entry-server.js")).href);
  const manifest = JSON.parse(await readFile(join(root, "dist/client/droplets.json"), "utf8"));
  const app = createServerApp({
    ssr,
    config: resolveConfig(config),
    assets: {
      buildHash: manifest.__hash,
      loadClientModule: async () => null,
      loadEntryClient: async () => null,
      entryModule: async () => null,
      loadGlobalStyle: async () => null,
      dropletStyles: async (id) => manifest.droplets[id]?.css ?? [],
      loadIndex: async () => null,
      loadPrerendered: createPrerenderedLoader((path) => readFile(join(renders, path), "utf8").catch(() => null)),
      externals: [],
      assetHandler: (c) => c.text("Not Found", 404),
    },
  });
  const response = await app.request("http://drops.test/droplets/page", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ props }),
  });
  expect(response.status).toBe(200);
  return response.text();
}

const roots: string[] = [];
let report: MockInstance<typeof logger.report>;

beforeEach(() => {
  report = vi.spyOn(logger, "report");
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/** The warnings the build gave: code, droplet and parameters. */
const warnings = () => report.mock.calls.map(([{ message, droplet, params }]) => ({ code: message.code, droplet, params }));

describe("prerender files, with location and host fixed", () => {
  it("writes an entry's file as the server's answer for its props, with no token, and nothing for an entry without one", async () => {
    const root = await project({
      server: `${LOAD}export const entries = () => [{ props: { page: 2 }, file: "page-2" }, { props: { page: 3 } }];\n`,
      config: FIXED,
    });
    await build({ root });
    expect(await prerenderFiles({ root })).toEqual(["page/page-2.html"]);
    const file = await fileText({ root, path: "page/page-2.html" });
    expect(file).toContain('<p class="page">2 https://cdn.test/mfe/api/x</p>');
    expect(file).toMatch(/<link rel="stylesheet" href="https:\/\/cdn\.test\/mfe\/droplets\/page\/style\.css\?c=[\w-]+"/);
    expect(file).not.toMatch(/DROPLET_|droplets\.invalid|__\$/);
    expect(file).toBe(
      await serverAnswer({
        root,
        renders: join(root, "dist/server/_prerendered"),
        config: { location: "https://cdn.test/mfe", host: "https://shop.test" },
        props: { page: 2 },
      }),
    );
    expect(warnings()).toEqual([]);
  }, 90_000);

  it("writes them in the client build for a Worker too, never under its renders' directory", async () => {
    const root = await project({
      server: `${LOAD}export const entries = () => [{ props: { page: 2 }, file: "page-2" }];\n`,
      config: FIXED,
    });
    await build({ root, separateSsrBundle: false });
    expect(await prerenderFiles({ root })).toEqual(["page/page-2.html"]);
    expect(await fileText({ root, path: "page/page-2.html" })).toContain('<p class="page">2 https://cdn.test/mfe/api/x</p>');
    const renders = (await readdir(join(root, "dist/client/_prerendered"), { recursive: true })).map(String);
    expect(renders.some((path) => path.endsWith(".html"))).toBe(false);
  }, 90_000);

  it("writes one file per name from one render when the schema makes two entries the same props", async () => {
    const root = await project({
      server: `${LOAD}export const entries = () => [{ props: { page: 1 }, file: "first" }, { props: { page: 1 }, file: "again" }];\n`,
      config: FIXED,
    });
    await build({ root });
    expect(await prerenderFiles({ root })).toEqual(["page/again.html", "page/first.html"]);
    expect(await fileText({ root, path: "page/again.html" })).toBe(await fileText({ root, path: "page/first.html" }));
  }, 90_000);

  it("runs transform into the file, and renders an entry's own page of host", async () => {
    const root = await project({
      server:
        "export const load = ({ host }) => ({ page: host.pathname, home: host.origin });\n" +
        "export const transform = ({ html }) => `${html}<!--transformed-->`;\n" +
        'export const entries = () => [{ file: "docs", host: "https://shop.test/docs" }];\n',
      config: FIXED,
    });
    await build({ root });
    const file = await fileText({ root, path: "page/docs.html" });
    expect(file).toContain('<p class="page">/docs https://shop.test</p><!--transformed-->');
  }, 90_000);

  it("writes no file for a render that failed or was not stored, and says so", async () => {
    const root = await project({
      server:
        'import { error } from "$droplets/server";\n' +
        "export const load = ({ props }) => {\n" +
        '  if (props.page === 404) error(404, "gone");\n' +
        '  if (props.page === 500) throw new Error("broken");\n' +
        "  return { page: props.page, home: '' };\n" +
        "};\n" +
        'export const entries = () => [{ props: { page: 404 }, file: "gone" }, { props: { page: 500 }, file: "broken" }, { props: { page: 1 }, file: "fine" }];\n',
      config: FIXED,
    });
    await mkdir(join(root, "src/droplets/page"), { recursive: true });
    await writeFile(join(root, "src/droplets/page/+error.fake.js"), "export default ({ error }) => `<p>${error.message}</p>`;\n");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await build({ root });
    expect(await prerenderFiles({ root })).toEqual(["page/fine.html"]);
    expect(warnings()).toEqual([
      {
        code: "prerender-render-not-stored",
        droplet: "page",
        params: { props: '{"page":404}', status: 404, path: "assets/prerendered/page/gone.html" },
      },
      {
        code: "prerender-file-error-page",
        droplet: "page",
        params: { props: '{"page":500}', path: "assets/prerendered/page/broken.html" },
      },
    ]);
  }, 90_000);

  it("warns that a file is served without the headers its load set", async () => {
    const root = await project({
      server:
        "export const load = ({ setHeaders }) => {\n" +
        '  setHeaders({ "x-page": "1" });\n' +
        "  return { page: 1, home: '' };\n" +
        "};\n" +
        'export const entries = () => [{ file: "one" }];\n',
      config: FIXED,
    });
    await build({ root });
    expect(await prerenderFiles({ root })).toEqual(["page/one.html"]);
    expect(warnings()).toEqual([
      { code: "prerender-file-headers-dropped", droplet: "page", params: { headers: "x-page", path: "assets/prerendered/page/one.html" } },
    ]);
  }, 90_000);

  it("writes the file whatever render.timeout says: the build waits for every load", async () => {
    const root = await project({
      server:
        "export const load = async () => {\n" +
        "  await new Promise((done) => setTimeout(done, 50));\n" +
        "  return { page: 1, home: '' };\n" +
        "};\n" +
        'export const entries = () => [{ file: "slow" }];\n',
      config: 'export default { location: "https://cdn.test/mfe", host: "https://shop.test", render: { timeout: 1 } };\n',
    });
    await build({ root });
    expect(await fileText({ root, path: "page/slow.html" })).toContain('<p class="page">1 </p>');
  }, 90_000);

  it("writes the data payload a production server answers with: load's result, or the server data with render.rerunLoad", async () => {
    const universal = "export const load = ({ data }) => ({ ...data, page: `#${data.page}` });\n";
    const server = `${LOAD}export const entries = () => [{ props: { page: 4 }, file: "four" }];\n`;
    const payloadOf = (html: string, name: string) => {
      const match = html.match(new RegExp(`data-droplet-payload="${name}">([^<]+)<`))?.[1];
      return match ? JSON.parse(Buffer.from(match, "base64").toString()) : undefined;
    };
    const fixed = { location: "https://cdn.test/mfe", host: "https://shop.test" };
    for (const rerunLoad of [false, true]) {
      const config = `export default { location: "https://cdn.test/mfe", host: "https://shop.test", render: { rerunLoad: ${rerunLoad} } };\n`;
      const root = await project({ server, universal, config });
      await build({ root });
      const file = await fileText({ root, path: "page/four.html" });
      expect(file).toContain('<p class="page">#4 https://cdn.test/mfe/api/x</p>');
      if (rerunLoad) {
        expect(payloadOf(file, "data")).toBeUndefined();
        expect(payloadOf(file, "server")).toEqual({ server: { page: 4, home: "https://cdn.test/mfe/api/x" } });
      } else {
        expect(payloadOf(file, "server")).toBeUndefined();
        expect(payloadOf(file, "data")).toEqual({ data: { page: "#4", home: "https://cdn.test/mfe/api/x" } });
      }
      const renders = join(root, "dist/server/_prerendered");
      expect(file).toBe(await serverAnswer({ root, renders, config: { ...fixed, render: { rerunLoad } }, props: { page: 4 } }));
      // The stored render keeps load's result only when it goes into the HTML.
      const stored = (await readdir(renders, { recursive: true })).filter((name) => name.endsWith(".json") && !name.endsWith("index.json"));
      const records = await Promise.all(stored.map(async (name) => JSON.parse(await readFile(join(renders, name), "utf8"))));
      expect(records.filter((record) => typeof record.html === "string")).toHaveLength(1);
      expect(records.some((record) => "loadResult" in record)).toBe(!rerunLoad);
    }
  }, 120_000);

  it("removes the files of the build before: a file no entry names any more is gone", async () => {
    const root = await project({
      server: `${LOAD}export const entries = () => [{ props: { page: 2 }, file: "page-2" }];\n`,
      config: FIXED,
    });
    await build({ root });
    expect(await prerenderFiles({ root })).toEqual(["page/page-2.html"]);
    await writeFile(join(root, "src/droplets/page/+droplet.server.ts"), `${LOAD}export const entries = () => [{ props: { page: 2 } }];\n`);
    await build({ root });
    expect(await prerenderFiles({ root })).toEqual([]);
  }, 120_000);
});

describe("prerender files, without location and host both set", () => {
  for (const [config, missing] of [
    ['export default { location: "https://cdn.test/mfe" };\n', "host is"],
    ['export default { host: "https://shop.test" };\n', "location is"],
    [undefined, "location and host are"],
  ] as const) {
    it(`writes none and warns once: ${missing} not set`, async () => {
      const root = await project({
        server: `${LOAD}export const entries = () => [1, 2, 3, 4, 5, 6].map((page) => ({ props: { page }, file: \`page-\${page}\` }));\n`,
        ...(config ? { config } : {}),
      });
      await build({ root });
      expect(await prerenderFiles({ root })).toEqual([]);
      expect(warnings()).toEqual([
        {
          code: "prerender-files-need-location-and-host",
          droplet: undefined,
          params: { listed: "page/page-1, page/page-2, page/page-3, page/page-4, page/page-5, …", missing },
        },
      ]);
    }, 90_000);
  }

  it("still fails the build for a bad file, naming the droplet", async () => {
    const root = await project({ server: `${LOAD}export const entries = () => [{ props: { page: 2 }, file: "Page 2" }];\n` });
    await expect(build({ root })).rejects.toThrow(/droplet: page\n[\s\S]*an entry's file is a lowercase kebab-case name, got "Page 2"/);
  }, 90_000);

  it("still fails it for a file two entries name", async () => {
    const root = await project({
      server: `${LOAD}export const entries = () => [{ props: { page: 1 }, file: "page" }, { props: { page: 2 }, file: "page" }];\n`,
      config: FIXED,
    });
    await expect(build({ root })).rejects.toThrow(/droplet: page\n[\s\S]*two entries name the file "page"/);
  }, 90_000);
});
