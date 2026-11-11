/**
 * `host` at build: an entry's `host`, `prerender.host`, `PUBLIC_URL`, or the
 * token stand-in, whose other fields stop a real `vite build`.
 */
import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

type ProjectInput = { server: string; env?: string };

/** A project with one prerendered droplet; `server` is its `+droplet.server.ts`. */
async function project({ server, env }: ProjectInput): Promise<string> {
  const root = await mkdtemp(join(fixtures, ".prerender-host-"));
  const folder = join(root, "src/droplets/page");
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "+droplet.fake.js"),
    'export const prerender = true;\n\nexport default ({ data }) => `<a href="${data.home}">${data.path}</a>`;\n',
  );
  await writeFile(join(folder, "+droplet.server.ts"), server);
  if (env) await writeFile(join(root, ".env"), env);
  return root;
}

type BuildInput = { root: string; prerender?: { host: string } };

const build = ({ root, prerender }: BuildInput) =>
  createBuilder({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [droplets({ adapter: fakeAdapter, renderers: [fakeRenderer()], ...(prerender ? { prerender } : {}) })],
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

  it("renders for the entry's host, else prerender.host, keyed by that host", async () => {
    const root = await project({
      server: `${LOAD}export const entries = () => [{ props: { a: 1 }, host: "https://entry.test/docs?q=1" }, { props: { a: 2 } }];\n`,
    });
    roots.push(root);
    await build({ root, prerender: { host: "https://config.test/base" } });
    expect(await stored(root)).toEqual({
      '{"a":1} https://entry.test/docs': { home: "https://entry.test/home", path: "/docs" },
      '{"a":2} https://config.test/base': { home: "https://config.test/home", path: "/base" },
    });
  }, 90_000);

  it("takes PUBLIC_URL when nothing else gives a host, and tokens without it", async () => {
    const withUrl = await project({ server: LOAD, env: "PUBLIC_URL=https://public.test/\n" });
    roots.push(withUrl);
    await build({ root: withUrl });
    expect(await stored(withUrl)).toEqual({
      "{} https://public.test/": { home: "https://public.test/home", path: "/" },
    });

    const agnostic = await project({ server: LOAD });
    roots.push(agnostic);
    await build({ root: agnostic });
    expect(await stored(agnostic)).toEqual({
      "{}": { home: "__$DROPLET_HOST_<nonce>$__/home", path: "__$DROPLET_PATH_<nonce>$__" },
    });
  }, 120_000);

  it("refuses entries that are bare props", async () => {
    const root = await project({ server: `${LOAD}export const entries = () => [{ page: 1 }];\n` });
    roots.push(root);
    await expect(build({ root: root })).rejects.toThrow("entries() returns events, { props?, host? }");
  }, 90_000);
});
