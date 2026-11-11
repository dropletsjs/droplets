/**
 * `host` at build: an entry's `host`, `host` of `droplets.config.ts`, or the
 * token stand-in, whose other fields stop a real `vite build`.
 */
import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBuilder } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { fakeRenderer } from "../../src/testing/index.ts";
import { droplets, type DropletsAdapter } from "../../src/vite.ts";

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));

const fakeAdapter: DropletsAdapter = {
  name: "fake",
  serverEntry: resolve(fixtures, "app/fake-entry.js"),
  serverFile: "server.js",
  separateSsrBundle: true,
};

type ProjectInput = { server: string; config?: string };

/** A project with one prerendered droplet; `server` is its `+droplet.server.ts`, `config` its `droplets.config.ts`. */
async function project({ server, config }: ProjectInput): Promise<string> {
  const root = await mkdtemp(join(fixtures, ".prerender-host-"));
  const folder = join(root, "src/droplets/page");
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "+droplet.fake.js"),
    'export const prerender = true;\n\nexport default ({ data }) => `<a href="${data.home}">${data.path}</a>`;\n',
  );
  await writeFile(join(folder, "+droplet.server.ts"), server);
  if (config) await writeFile(join(root, "droplets.config.ts"), config);
  return root;
}

type BuildInput = { root: string };

const build = ({ root }: BuildInput) =>
  createBuilder({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [droplets({ adapter: fakeAdapter, renderers: [fakeRenderer()] })],
  }).then((builder) => builder.buildApp());

/** Every stored render's server data, by key. */
async function stored(root: string): Promise<Record<string, unknown>> {
  const client = join(root, "dist/server/_prerendered");
  const index = JSON.parse(await readFile(join(client, "page/index.json"), "utf8")) as Record<string, string>;
  const renders: Record<string, unknown> = {};
  for (const [key, file] of Object.entries(index)) {
    const render = JSON.parse(await readFile(join(client, file), "utf8")) as { data: unknown; nonce?: string };
    // The tokens carry the build's nonce: shown here as <nonce>.
    renders[key] = render.nonce ? JSON.parse(JSON.stringify(render.data).replaceAll(render.nonce, "<nonce>")) : render.data;
  }
  return renders;
}

const LOAD = "export const load = ({ host }) => ({ home: `${host.origin}/home`, path: host.pathname });\n";

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("host while prerendering", () => {
  it("stops the build when a render reads host.searchParams without a host", async () => {
    const root = await project({ server: 'export const load = ({ host }) => ({ q: host.searchParams.get("q") });\n' });
    roots.push(root);
    await expect(build({ root: root })).rejects.toThrow(
      "droplets: page: host.searchParams is not known while prerendering entry {}; only host.origin, host.pathname and host.href are.",
    );
  }, 90_000);

  it("stops it even when the droplet catches the error", async () => {
    const root = await project({
      server: "export const load = ({ host }) => {\n  try {\n    return { port: host.port };\n  } catch {\n    return {};\n  }\n};\n",
    });
    roots.push(root);
    await expect(build({ root: root })).rejects.toThrow("host.port is not known while prerendering");
  }, 90_000);

  it("renders for the entry's host, else host of the config, keyed by that host", async () => {
    const root = await project({
      server: `${LOAD}export const entries = () => [{ props: { a: 1 }, host: "https://entry.test/docs?q=1" }, { props: { a: 2 } }];\n`,
      config: 'export default { host: "https://config.test" };\n',
    });
    roots.push(root);
    await build({ root });
    expect(await stored(root)).toEqual({
      '{"a":1} https://entry.test/docs': { home: "https://entry.test/home", path: "/docs" },
      '{"a":2} https://config.test': { home: "https://config.test/home", path: "__$DROPLET_PATH_<nonce>$__" },
    });
  }, 90_000);

  it("gives a render for host of the config a real URL: its origin's fields, an empty query", async () => {
    const root = await project({
      server:
        "export const load = ({ host }) => ({ home: `${host.protocol}//${host.hostname}:${host.port}`, path: `[${host.search}${host.hash}${host.searchParams.size}]` });\n",
      config: 'export default { host: "https://config.test:8443" };\n',
    });
    roots.push(root);
    await build({ root });
    expect(await stored(root)).toEqual({ "{} https://config.test:8443": { home: "https://config.test:8443", path: "[0]" } });
  }, 90_000);

  it("renders host-agnostic, with tokens, when nothing gives a host", async () => {
    const agnostic = await project({ server: LOAD });
    roots.push(agnostic);
    await build({ root: agnostic });
    expect(await stored(agnostic)).toEqual({
      "{}": { home: "__$DROPLET_HOST_<nonce>$__/home", path: "__$DROPLET_PATH_<nonce>$__" },
    });
  }, 120_000);

  it("renders on the config's location, when it has one", async () => {
    const root = await project({
      server: 'import droplet from "$droplets/drop";\nexport const load = () => ({ home: droplet.url("/api/x"), path: droplet.origin });\n',
      config: 'export default { location: "https://cdn.test/mfe" };\n',
    });
    roots.push(root);
    await build({ root });
    expect(await stored(root)).toEqual({ "{}": { home: "https://cdn.test/mfe/api/x", path: "https://cdn.test/mfe" } });
  }, 90_000);

  it("serves a render made with location and host fixed exactly as stored, with no token or nonce", async () => {
    const root = await project({
      server:
        'import droplet from "$droplets/drop";\nexport const load = ({ host }) => ({ home: `${droplet.url("/api/x")} ${host.origin}`, path: host.pathname });\n',
      config: 'export default { location: "https://cdn.test/mfe", host: "https://shop.test" };\n',
    });
    roots.push(root);
    await build({ root });
    const dir = join(root, "dist/server/_prerendered");
    const index = JSON.parse(await readFile(join(dir, "page/index.json"), "utf8")) as Record<string, string>;
    expect(Object.keys(index)).toEqual(["{} https://shop.test"]);
    const file = await readFile(join(dir, index["{} https://shop.test"] ?? ""), "utf8");
    const render = JSON.parse(file) as { html: string; data: unknown; nonce?: string };
    expect(render.nonce).toBeUndefined();
    expect(render.data).toEqual({ home: "https://cdn.test/mfe/api/x https://shop.test", path: "/" });
    expect(file).not.toMatch(/DROPLET_|droplets\.invalid/);

    const { createPrerenderedLoader, createServerApp, resolveConfig } = await import("../../src/index.ts");
    const ssr = await import(pathToFileURL(join(root, "dist/server/entry-server.js")).href);
    expect(ssr.tokens).toBeUndefined();
    expect(ssr.tokenNonce).toBeUndefined();
    const app = createServerApp({
      ssr,
      config: resolveConfig({ location: "https://cdn.test/mfe", host: "https://shop.test" }),
      assets: {
        buildHash: "x",
        loadClientModule: async () => null,
        loadEntryClient: async () => null,
        entryModule: async () => null,
        loadGlobalStyle: async () => null,
        dropletStyles: async () => [],
        loadIndex: async () => null,
        loadPrerendered: createPrerenderedLoader((path) => readFile(join(dir, path), "utf8").catch(() => null)),
        externals: [],
        assetHandler: (c) => c.text("Not Found", 404),
      },
    });
    const ask = (path: string) =>
      app.request(`http://drops.test${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ host: "https://shop.test/other?q=1", props: {} }),
      });
    expect(await (await ask("/droplets/page/_data")).text()).toBe(JSON.stringify({ data: render.data }));
    expect(await (await ask("/droplets/page")).text()).toContain(render.html);
  }, 90_000);

  it("refuses entries that are bare props", async () => {
    const root = await project({ server: `${LOAD}export const entries = () => [{ page: 1 }];\n` });
    roots.push(root);
    await expect(build({ root: root })).rejects.toThrow("entries() returns events, { props?, host? }");
  }, 90_000);
});
